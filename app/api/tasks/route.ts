import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { toTaskRecord } from "@/lib/tasks/task-repository";
import type { Task } from "@/types/database";

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

    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("session_id", sessionId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const tasks = (data ?? []).map((row) => toTaskRecord(row as Task));
    return NextResponse.json(tasks);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch tasks";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
