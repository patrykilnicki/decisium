import type { RootGraphState } from "@/packages/agents/core/root.agent";
import {
  memoryRetrieverNode,
  rootResponseAgentNode,
  saveAssistantMessageNode,
  saveUserMessageNode,
} from "@/packages/agents/core/root.agent";
import {
  processOrchestratorMessage,
  type OrchestratorToolEvent,
} from "@/packages/agents/core/orchestrator.agent";
import type {
  TaskExecutionResult,
  TaskInsert,
  TaskRow,
} from "@/lib/tasks/task-types";
import type { TaskType } from "@/lib/tasks/task-definitions";
import type { Json } from "@/types/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTaskEvent } from "@/lib/tasks/task-events";
import { runWithTaskContext } from "@/packages/agents/lib/task-context";

function buildNextTask(params: {
  parentTaskId: string;
  userId: string;
  sessionId: string;
  taskType: TaskType;
  state: object;
}): TaskInsert {
  return {
    parent_task_id: params.parentTaskId,
    user_id: params.userId,
    session_id: params.sessionId,
    task_type: params.taskType,
    status: "pending",
    input: { state: params.state } as Json,
  };
}

function getTaskState<T extends object>(task: TaskRow): T {
  const input = task.input as { state?: T } | null | undefined;
  return (input?.state ?? {}) as T;
}

function getRootNextTaskType(taskType: TaskType): TaskType | null {
  switch (taskType) {
    case "root.save_user_message":
      return "root.memory_retriever";
    case "root.memory_retriever":
      return "root.response_agent";
    case "root.response_agent":
      return "root.save_assistant_message";
    case "root.save_assistant_message":
      return null;
    default:
      return null;
  }
}

export async function handleTask(
  task: TaskRow,
  options?: { jobId?: string },
): Promise<TaskExecutionResult> {
  const client = createAdminClient();
  const jobId = options?.jobId ?? task.id;
  const taskType = task.task_type as TaskType;
  if (taskType.startsWith("root.")) {
    return handleRootTask(task, taskType, { client, jobId });
  }
  if (taskType === "orchestrator.invoke") {
    return handleOrchestratorInvoke(task, { client, jobId });
  }
  throw new Error(`Unknown task type: ${taskType}`);
}

async function handleRootTask(
  task: TaskRow,
  taskType: TaskType,
  options: { client: SupabaseClient<Database>; jobId: string },
): Promise<TaskExecutionResult> {
  const state = getTaskState<RootGraphState>(task);
  let partialState: Partial<RootGraphState> = {};

  switch (taskType) {
    case "root.save_user_message":
      partialState = await runNodeWithEvents({
        client: options.client,
        task,
        jobId: options.jobId,
        nodeKey: taskType,
        handler: () => saveUserMessageNode(state),
      });
      break;
    case "root.memory_retriever":
      partialState = await runNodeWithEvents({
        client: options.client,
        task,
        jobId: options.jobId,
        nodeKey: taskType,
        handler: () => memoryRetrieverNode(state),
      });
      break;
    case "root.response_agent":
      partialState = await runNodeWithEvents({
        client: options.client,
        task,
        jobId: options.jobId,
        nodeKey: taskType,
        handler: () => rootResponseAgentNode(state),
      });
      break;
    case "root.save_assistant_message":
      partialState = await runNodeWithEvents({
        client: options.client,
        task,
        jobId: options.jobId,
        nodeKey: taskType,
        handler: () => saveAssistantMessageNode(state),
      });
      break;
  }

  const nextState: RootGraphState = { ...state, ...partialState };
  const nextTaskType = getRootNextTaskType(taskType);

  if (!nextTaskType) {
    return { output: { state: nextState } };
  }

  return {
    output: { state: nextState },
    nextTasks: [
      buildNextTask({
        parentTaskId: task.id,
        userId: task.user_id,
        sessionId: task.session_id,
        taskType: nextTaskType,
        state: nextState,
      }),
    ],
  };
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
    userEmail?: string;
    conversationHistory?: string;
    userMessageId?: string;
    preferredModel?: string;
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
        ...(event.error ? { error: event.error } : {}),
      },
    });
  }

  const result = await runNodeWithEvents({
    client: options.client,
    task,
    jobId: options.jobId,
    nodeKey: "orchestrator.invoke",
    handler: () =>
      processOrchestratorMessage({
        userId: state.userId,
        threadId: state.threadId,
        userMessage: state.userMessage,
        currentDate: state.currentDate,
        userEmail: state.userEmail,
        conversationHistory: state.conversationHistory,
        preferredModel: state.preferredModel,
        onToolEvent,
      }),
  });

  return {
    output: {
      state: {
        ...state,
        agentResponse: result.agentResponse,
        userMessageId: result.userMessageId ?? state.userMessageId,
        assistantMessageId: result.assistantMessageId,
        toolsUsed: result.toolsUsed,
      },
      agentResponse: result.agentResponse,
      userMessageId: result.userMessageId,
      assistantMessageId: result.assistantMessageId,
      toolsUsed: result.toolsUsed,
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
