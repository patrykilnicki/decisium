import type { Json } from "@/types/supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import * as db from "@/lib/supabase/db";
import { getTaskContext } from "./task-context";

interface PromptLogParams {
  userId?: string;
  taskId?: string | null;
  sessionId?: string | null;
  taskType?: string | null;
  nodeKey?: string | null;
  agentType: string;
  model?: string;
  temperature?: number;
  systemPrompt?: string;
  messages?: unknown;
  metadata?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  return /password|secret|token|api[_-]?key|authorization|cookie|session/i.test(
    key,
  );
}

function redactString(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\b(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi, "$1 [REDACTED_TOKEN]")
    .replace(/\bsk-[A-Za-z0-9]{16,}\b/g, "[REDACTED_API_KEY]")
    .replace(
      /(["']?(?:password|secret|token|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)([^"'\s,}]+)/gi,
      "$1[REDACTED_SECRET]",
    );
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean" || value == null)
    return value;
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item));
  if (!isRecord(value)) return String(value);

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      redacted[key] = "[REDACTED_SECRET]";
      continue;
    }
    redacted[key] = redactUnknown(nestedValue);
  }
  return redacted;
}

function toSerializable(value: unknown): unknown {
  const seen = new WeakSet<object>();

  try {
    return JSON.parse(
      JSON.stringify(value, (_key, nestedValue: unknown) => {
        if (typeof nestedValue === "bigint") return nestedValue.toString();
        if (typeof nestedValue === "function") return "[Function]";
        if (typeof nestedValue === "symbol") return nestedValue.toString();
        if (nestedValue instanceof Date) return nestedValue.toISOString();
        if (typeof nestedValue === "object" && nestedValue !== null) {
          if (seen.has(nestedValue)) return "[Circular]";
          seen.add(nestedValue);
        }
        return nestedValue;
      }),
    );
  } catch {
    return String(value);
  }
}

export async function logPromptPayload(params: PromptLogParams): Promise<void> {
  try {
    const context = getTaskContext();
    const userId = params.userId ?? context?.userId;
    if (!userId) return;

    const serializableMessages = toSerializable(params.messages ?? []);
    const redactedMessages = redactUnknown(serializableMessages);
    const redactedSystemPrompt = redactString(params.systemPrompt ?? "");
    const redactedMetadata = redactUnknown({
      ...(params.metadata ?? {}),
      redaction: "enabled",
    });

    const row = {
      user_id: userId,
      task_id: params.taskId ?? context?.taskId ?? null,
      session_id: params.sessionId ?? context?.sessionId ?? null,
      task_type: params.taskType ?? context?.taskType ?? null,
      node_key: params.nodeKey ?? context?.nodeKey ?? null,
      agent_type: params.agentType,
      model: params.model ?? null,
      temperature: params.temperature ?? null,
      system_prompt: redactedSystemPrompt,
      messages: redactedMessages as Json,
      metadata: redactedMetadata as Json,
    };

    const client = createAdminClient();
    const { error } = await db.insertOne(
      client,
      "agent_prompt_logs",
      row as never,
    );
    if (error) {
      console.error(
        "[logPromptPayload] Failed to store prompt log:",
        error.message,
      );
    }
  } catch (error) {
    console.error("[logPromptPayload] Error logging prompt:", error);
  }
}
