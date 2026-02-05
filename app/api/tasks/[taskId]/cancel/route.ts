import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Task } from "@/types/database";

type RouteParams = { params: Promise<{ taskId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { taskId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data: taskData, error } = await adminClient
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .single();

    if (error || !taskData) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (taskData.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: updated, error: updateError } = await adminClient
      .from("tasks")
      .update({
        status: "failed",
        last_error: "Cancelled by user",
      })
      .eq("id", taskId)
      .select()
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        { error: updateError?.message ?? "Failed to cancel task" },
        { status: 400 },
      );
    }

    return NextResponse.json(updated as Task);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to cancel task";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
