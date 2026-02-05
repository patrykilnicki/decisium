import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { toTaskRecord } from "@/lib/tasks/task-repository";
import type { Task } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const pollIntervalMs = 1000;
const keepAliveIntervalMs = 15000;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return new Response(JSON.stringify({ error: "sessionId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sessionIdValue: string = sessionId;
  const userId: string = user.id;

  const encoder = new TextEncoder();
  let lastPayload = "";
  let closeStream: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
      let isClosed = false;

      function sendEvent(data: unknown, event?: string) {
        if (isClosed) return;
        const prefix = event ? `event: ${event}\n` : "";
        const payload = `${prefix}data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      }

      async function fetchAndEmit() {
        const { data, error } = await supabase
          .from("tasks")
          .select("*")
          .eq("session_id", sessionIdValue)
          .eq("user_id", userId)
          .order("created_at", { ascending: true });

        if (error) {
          sendEvent({ error: error.message }, "error");
          return;
        }

        const tasks = (data ?? []).map((row) => toTaskRecord(row as Task));
        const payload = JSON.stringify(tasks);
        if (payload !== lastPayload) {
          lastPayload = payload;
          sendEvent(tasks);
        }
      }

      function startPolling() {
        fetchAndEmit().catch((error) => {
          const message =
            error instanceof Error ? error.message : "Failed to stream tasks";
          sendEvent({ error: message }, "error");
        });
        pollTimer = setInterval(() => {
          fetchAndEmit().catch((error) => {
            const message =
              error instanceof Error ? error.message : "Failed to stream tasks";
            sendEvent({ error: message }, "error");
          });
        }, pollIntervalMs);
        keepAliveTimer = setInterval(() => {
          if (isClosed) return;
          controller.enqueue(encoder.encode(":\n\n"));
        }, keepAliveIntervalMs);
      }

      function close() {
        if (isClosed) return;
        isClosed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        controller.close();
      }

      closeStream = close;
      request.signal.addEventListener("abort", close);
      startPolling();
    },
    cancel() {
      closeStream?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
