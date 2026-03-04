import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as db from "@/lib/supabase/db";
import { createTaskEvent } from "@/lib/tasks/task-events";
import { resolveRootTaskId } from "@/lib/tasks/task-repository";
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
    const { data: taskData, error } = await db.selectOne(adminClient, "tasks", {
      id: taskId,
    });

    if (error || !taskData) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (taskData.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: updated, error: updateError } = await db.update(
      adminClient,
      "tasks",
      { id: taskId },
      { status: "failed", last_error: "Cancelled by user" },
      { returning: "single" },
    );

    if (updateError || !updated) {
      return NextResponse.json(
        { error: updateError?.message ?? "Failed to cancel task" },
        { status: 400 },
      );
    }

    const taskRow = updated as Task;
    const jobId = await resolveRootTaskId(adminClient, taskId);
    await createTaskEvent(adminClient, {
      taskId,
      sessionId: taskRow.session_id,
      userId: taskRow.user_id,
      eventType: "job_failed",
      nodeKey: "job",
      payload: {
        jobId,
        taskId,
        sessionId: taskRow.session_id,
        taskType: taskRow.task_type,
        error: "Cancelled by user",
      },
    });

    return NextResponse.json(taskRow);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to cancel task";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
