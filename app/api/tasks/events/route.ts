import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchTaskEventsBySession } from "@/lib/tasks/task-events";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const events = await fetchTaskEventsBySession(supabase, sessionId, user.id);
    return NextResponse.json(events);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch task events";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
