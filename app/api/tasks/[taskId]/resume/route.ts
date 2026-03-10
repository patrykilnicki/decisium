import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as db from "@/lib/supabase/db";
import { createTaskEvent } from "@/lib/tasks/task-events";
import { resolveRootTaskId } from "@/lib/tasks/task-repository";
import type { Task } from "@/types/database";
import { approvalSubmissionSchema } from "@/packages/agents/schemas/agent-ui.schema";
import { triggerTask } from "@/lib/tasks/task-processor";

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

    const rawBody = await request.json().catch(() => ({}));
    const parsedSubmission = approvalSubmissionSchema.safeParse(rawBody);
    const approval = parsedSubmission.success ? parsedSubmission.data : null;
    const currentInput =
      (taskData.input as { state?: Record<string, unknown> } | null) ?? {};
    const currentState = currentInput.state ?? {};
    const nextState = {
      ...currentState,
      ...(approval
        ? {
            approvalDecision: approval.decision,
            approvalEditedProps: approval.editedProps,
            approvalStatus:
              approval.decision === "reject"
                ? "rejected"
                : approval.decision === "edit"
                  ? "edited"
                  : "approved",
          }
        : {}),
    };

    const { data: updated, error: updateError } = await db.update(
      adminClient,
      "tasks",
      { id: taskId },
      {
        status: "pending",
        last_error: null,
        input: { ...currentInput, state: nextState },
      },
      { returning: "single" },
    );

    if (updateError || !updated) {
      return NextResponse.json(
        { error: updateError?.message ?? "Failed to resume task" },
        { status: 400 },
      );
    }

    const taskRow = updated as Task;
    const jobId = await resolveRootTaskId(adminClient, taskId);
    if (approval) {
      await createTaskEvent(adminClient, {
        taskId,
        sessionId: taskRow.session_id,
        userId: taskRow.user_id,
        eventType: "approval_submitted",
        nodeKey: "orchestrator.invoke",
        eventKeySuffix: approval.proposalId,
        payload: {
          jobId,
          taskId,
          sessionId: taskRow.session_id,
          taskType: taskRow.task_type,
          proposalId: approval.proposalId,
          decision: approval.decision,
          edited: approval.decision === "edit",
        },
      });
    }
    await createTaskEvent(adminClient, {
      taskId,
      sessionId: taskRow.session_id,
      userId: taskRow.user_id,
      eventType: "job_resumed",
      nodeKey: "job",
      payload: {
        jobId,
        taskId,
        sessionId: taskRow.session_id,
        taskType: taskRow.task_type,
      },
    });

    triggerTask(taskId);

    return NextResponse.json(taskRow);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resume task";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
