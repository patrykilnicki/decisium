import {
  processOrchestratorMessage,
  type OrchestratorToolEvent,
} from "@/packages/agents/core/orchestrator.agent";
import type { TaskExecutionResult, TaskRow } from "@/lib/tasks/task-types";
import type { TaskType } from "@/lib/tasks/task-definitions";
import type {
  ApprovalDecision,
  TaskApprovalCardProps,
} from "@/packages/agents/schemas/agent-ui.schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTaskEvent } from "@/lib/tasks/task-events";
import { runWithTaskContext } from "@/packages/agents/lib/task-context";
import {
  createTodoGenerator,
  createOAuthManager,
  createSyncPipeline,
} from "@/lib/integrations";
import { runVaultFromEventsAgent } from "@/lib/vault/vault-from-events-agent";
import * as db from "@/lib/supabase/db";

async function getPreferredModelForUser(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<string | undefined> {
  const { data } = await db.selectOne(
    client,
    "users",
    { id: userId },
    {
      columns: "preferred_llm_model",
    },
  );
  return (
    (data as { preferred_llm_model?: string } | null)?.preferred_llm_model ??
    undefined
  );
}

function getTaskState<T extends object>(task: TaskRow): T {
  const input = task.input as { state?: T } | null | undefined;
  return (input?.state ?? {}) as T;
}

export async function handleTask(
  task: TaskRow,
  options?: { jobId?: string },
): Promise<TaskExecutionResult> {
  const client = createAdminClient();
  const jobId = options?.jobId ?? task.id;
  const taskType = task.task_type as TaskType;
  if (taskType === "orchestrator.invoke") {
    return handleOrchestratorInvoke(task, { client, jobId });
  }
  if (taskType === "insights.generate_todo_list") {
    return handleInsightsGenerateTodoList(task, { client, jobId });
  }
  if (taskType === "vault.sync_from_events") {
    return handleVaultSyncFromEvents(task, { client, jobId });
  }
  if (taskType === "integration.sync") {
    return handleIntegrationSync(task, { client, jobId });
  }
  throw new Error(`Unknown task type: ${taskType}`);
}

/**
 * Handle orchestrator.invoke: run the full Composio graph in one task.
 * Uses official agent-tools-agent loop for multi-round tool execution.
 */
async function handleOrchestratorInvoke(
  task: TaskRow,
  options: { client: SupabaseClient<Database>; jobId: string },
): Promise<TaskExecutionResult> {
  const state = getTaskState<{
    userId: string;
    threadId: string;
    userMessage: string;
    currentDate?: string;
    timezone?: string;
    userEmail?: string;
    conversationHistory?: string;
    userMessageId?: string;
    preferredModel?: string;
    pendingApproval?: {
      proposalId: string;
      component: "task_approval_card";
      props: TaskApprovalCardProps;
    };
    approvalDecision?: ApprovalDecision;
    approvalEditedProps?: TaskApprovalCardProps;
    approvalStatus?: "pending" | "approved" | "edited" | "rejected" | "applied";
  }>(task);

  async function onToolEvent(event: OrchestratorToolEvent): Promise<void> {
    await createTaskEvent(options.client, {
      taskId: task.id,
      sessionId: task.session_id,
      userId: task.user_id,
      eventType: event.eventType,
      nodeKey: "orchestrator.invoke",
      eventKeySuffix: `${event.toolCallId}:${event.eventType}`,
      payload: {
        jobId: options.jobId,
        taskId: task.id,
        sessionId: task.session_id,
        taskType: task.task_type,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        toolCallKey: event.toolCallKey,
        callIndex: event.callIndex,
        action: event.action,
        displayLabel: event.displayLabel,
        ...(event.payload ? { approval: event.payload } : {}),
        ...(event.error ? { error: event.error } : {}),
      },
    });
  }

  const result = await runNodeWithEvents({
    client: options.client,
    task,
    jobId: options.jobId,
    nodeKey: "orchestrator.invoke",
    currentDate: state.currentDate,
    handler: () =>
      processOrchestratorMessage({
        userId: state.userId,
        threadId: state.threadId,
        userMessage: state.userMessage,
        currentDate: state.currentDate,
        timezone: state.timezone,
        userEmail: state.userEmail,
        conversationHistory: state.conversationHistory,
        preferredModel: state.preferredModel,
        userMessageId: state.userMessageId,
        pendingApproval: state.pendingApproval,
        approvalDecision: state.approvalDecision,
        approvalEditedProps: state.approvalEditedProps,
        approvalStatus: state.approvalStatus,
        onToolEvent,
      }),
  });

  if (
    result.pendingApproval?.proposalId &&
    result.approvalStatus === "pending"
  ) {
    await createTaskEvent(options.client, {
      taskId: task.id,
      sessionId: task.session_id,
      userId: task.user_id,
      eventType: "approval_required",
      nodeKey: "orchestrator.invoke",
      eventKeySuffix: result.pendingApproval.proposalId,
      payload: {
        jobId: options.jobId,
        taskId: task.id,
        sessionId: task.session_id,
        taskType: task.task_type,
        proposalId: result.pendingApproval.proposalId,
        component: result.pendingApproval.component,
        props: result.pendingApproval.props,
      },
    });
  }

  if (
    state.pendingApproval?.proposalId &&
    result.approvalStatus === "applied"
  ) {
    await createTaskEvent(options.client, {
      taskId: task.id,
      sessionId: task.session_id,
      userId: task.user_id,
      eventType: "approval_applied",
      nodeKey: "orchestrator.invoke",
      eventKeySuffix: state.pendingApproval.proposalId,
      payload: {
        jobId: options.jobId,
        taskId: task.id,
        sessionId: task.session_id,
        taskType: task.task_type,
        proposalId: state.pendingApproval.proposalId,
      },
    });
  }

  if (
    state.pendingApproval?.proposalId &&
    result.approvalStatus === "rejected"
  ) {
    await createTaskEvent(options.client, {
      taskId: task.id,
      sessionId: task.session_id,
      userId: task.user_id,
      eventType: "approval_rejected",
      nodeKey: "orchestrator.invoke",
      eventKeySuffix: state.pendingApproval.proposalId,
      payload: {
        jobId: options.jobId,
        taskId: task.id,
        sessionId: task.session_id,
        taskType: task.task_type,
        proposalId: state.pendingApproval.proposalId,
      },
    });
  }

  return {
    output: {
      state: {
        ...state,
        agentResponse: result.agentResponse,
        userMessageId: result.userMessageId ?? state.userMessageId,
        assistantMessageId: result.assistantMessageId,
        toolsUsed: result.toolsUsed,
        pendingApproval: result.pendingApproval,
        approvalStatus: result.approvalStatus,
        approvalDecision: undefined,
        approvalEditedProps: undefined,
      },
      agentResponse: result.agentResponse,
      userMessageId: result.userMessageId,
      assistantMessageId: result.assistantMessageId,
      toolsUsed: result.toolsUsed,
      pendingApproval: result.pendingApproval,
      approvalStatus: result.approvalStatus,
    },
  };
}

async function handleInsightsGenerateTodoList(
  task: TaskRow,
  options: { client: SupabaseClient<Database>; jobId: string },
): Promise<TaskExecutionResult> {
  const state = getTaskState<{
    userId: string;
    date?: string;
    force?: boolean;
    incremental?: boolean;
    generatedFromEvent?: string;
    signalHints?: {
      threadId?: string;
      messageId?: string;
      subject?: string;
      eventId?: string;
    }[];
  }>(task);

  const userId = state.userId || task.user_id;
  const date = state.date ?? new Date().toISOString().split("T")[0];
  const force = state.force ?? true;
  const incremental = state.incremental ?? false;
  const preferredModel = await getPreferredModelForUser(options.client, userId);

  const result = await runNodeWithEvents({
    client: options.client,
    task,
    jobId: options.jobId,
    nodeKey: "insights.generate_todo_list",
    handler: async () => {
      const generator = createTodoGenerator(options.client);
      const eventSource =
        state.generatedFromEvent ?? "task.insights.generate_todo_list";
      const opts = {
        generatedFromEvent: eventSource,
        signalHints: state.signalHints,
        preferredModel,
      };

      if (incremental) {
        return generator.mergeNewTasksForDate(userId, date, {
          ...opts,
          updatedBecause: "webhook_change_detected",
        });
      }
      if (force) {
        return generator.regenerateForDate(userId, date, opts);
      }
      return generator.getOrGenerateForDate(userId, date, opts);
    },
  });

  return {
    output: {
      state: { ...state, todoList: result },
      todoList: result,
    },
  };
}

async function handleVaultSyncFromEvents(
  task: TaskRow,
  options: { client: SupabaseClient<Database>; jobId: string },
): Promise<TaskExecutionResult> {
  const state = getTaskState<{
    userId: string;
    sinceAt?: string | null;
    incremental?: boolean;
    generatedFromEvent?: string;
    externalIds?: string[];
  }>(task);

  const userId = state.userId || task.user_id;
  const preferredModel = await getPreferredModelForUser(options.client, userId);

  const result = await runNodeWithEvents({
    client: options.client,
    task,
    jobId: options.jobId,
    nodeKey: "vault.sync_from_events",
    handler: () =>
      runVaultFromEventsAgent(userId, {
        sinceAt: state.sinceAt,
        externalIds: state.externalIds,
        preferredModel,
      }),
  });

  return {
    output: {
      state: { ...state, vaultResult: result },
      vaultResult: result,
    },
  };
}

async function handleIntegrationSync(
  task: TaskRow,
  options: { client: SupabaseClient<Database>; jobId: string },
): Promise<TaskExecutionResult> {
  const state = getTaskState<{
    userId: string;
    integrationId: string;
    provider: string;
  }>(task);

  const integrationId = state.integrationId;
  const userId = state.userId ?? task.user_id;

  if (!integrationId) {
    throw new Error("integration.sync task missing integrationId in state");
  }

  const oauthManager = createOAuthManager(options.client);
  const syncPipeline = createSyncPipeline(options.client, oauthManager);

  await runNodeWithEvents({
    client: options.client,
    task,
    jobId: options.jobId,
    nodeKey: "integration.sync",
    handler: () => syncPipeline.sync(integrationId, { fullSync: true }),
  });

  return {
    output: {
      state: { userId, integrationId, provider: state.provider },
    },
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function runNodeWithEvents<T>(params: {
  client: SupabaseClient<Database>;
  task: TaskRow;
  jobId: string;
  nodeKey: string;
  currentDate?: string;
  handler: () => Promise<T> | T;
}): Promise<T> {
  return runWithTaskContext(
    {
      userId: params.task.user_id,
      sessionId: params.task.session_id,
      taskId: params.task.id,
      taskType: params.task.task_type,
      nodeKey: params.nodeKey,
      jobId: params.jobId,
      currentDate: params.currentDate,
    },
    async () => {
      const payloadBase = {
        jobId: params.jobId,
        taskId: params.task.id,
        taskType: params.task.task_type,
        sessionId: params.task.session_id,
      };

      await createTaskEvent(params.client, {
        taskId: params.task.id,
        sessionId: params.task.session_id,
        userId: params.task.user_id,
        eventType: "node_started",
        nodeKey: params.nodeKey,
        payload: payloadBase,
      });

      try {
        const result = await params.handler();
        await createTaskEvent(params.client, {
          taskId: params.task.id,
          sessionId: params.task.session_id,
          userId: params.task.user_id,
          eventType: "node_completed",
          nodeKey: params.nodeKey,
          payload: payloadBase,
        });
        return result;
      } catch (error) {
        const message = getErrorMessage(error);
        await createTaskEvent(params.client, {
          taskId: params.task.id,
          sessionId: params.task.session_id,
          userId: params.task.user_id,
          eventType: "node_failed",
          nodeKey: params.nodeKey,
          payload: { ...payloadBase, error: message },
        });
        throw error;
      }
    },
  );
}
