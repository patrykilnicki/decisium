import { END } from "@langchain/langgraph";
import type { RootGraphState } from "@/packages/agents/core/root.agent";
import {
  memoryRetrieverNode,
  rootResponseAgentNode,
  saveAssistantMessageNode,
  saveUserMessageNode,
} from "@/packages/agents/core/root.agent";
import type { OrchestratorState } from "@/packages/agents/schemas/orchestrator.schema";
import {
  gradeDocsNode,
  rewriteNode,
  routeOrchestrator,
  routerNode,
  saveMessagesNode,
  synthesizeNode,
  toolExecutorNode,
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

function getOrchestratorNextTaskType(route: string): TaskType | null {
  switch (route) {
    case "router":
      return "orchestrator.router";
    case "toolExecutor":
      return "orchestrator.tool_executor";
    case "gradeDocuments":
      return "orchestrator.grade_documents";
    case "rewriteQuery":
      return "orchestrator.rewrite_query";
    case "synthesize":
      return "orchestrator.synthesize";
    case "saveMessages":
      return "orchestrator.save_messages";
    case END:
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
  if (taskType.startsWith("orchestrator.")) {
    return handleOrchestratorTask(task, taskType, { client, jobId });
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

async function handleOrchestratorTask(
  task: TaskRow,
  taskType: TaskType,
  options: { client: SupabaseClient<Database>; jobId: string },
): Promise<TaskExecutionResult> {
  const state = getTaskState<OrchestratorState>(task);
  let partialState: Partial<OrchestratorState> = {};

  switch (taskType) {
    case "orchestrator.router":
      partialState = await runNodeWithEvents({
        client: options.client,
        task,
        jobId: options.jobId,
        nodeKey: taskType,
        handler: () => routerNode(state),
      });
      break;
    case "orchestrator.tool_executor":
      partialState = await runNodeWithEvents({
        client: options.client,
        task,
        jobId: options.jobId,
        nodeKey: taskType,
        handler: () => toolExecutorNode(state),
      });
      break;
    case "orchestrator.grade_documents":
      partialState = await runNodeWithEvents({
        client: options.client,
        task,
        jobId: options.jobId,
        nodeKey: taskType,
        handler: () => gradeDocsNode(state),
      });
      break;
    case "orchestrator.rewrite_query":
      partialState = await runNodeWithEvents({
        client: options.client,
        task,
        jobId: options.jobId,
        nodeKey: taskType,
        handler: () => rewriteNode(state),
      });
      break;
    case "orchestrator.synthesize":
      partialState = await runNodeWithEvents({
        client: options.client,
        task,
        jobId: options.jobId,
        nodeKey: taskType,
        handler: () => synthesizeNode(state),
      });
      break;
    case "orchestrator.save_messages":
      partialState = await runNodeWithEvents({
        client: options.client,
        task,
        jobId: options.jobId,
        nodeKey: taskType,
        handler: () => saveMessagesNode(state),
      });
      break;
  }

  const nextState: OrchestratorState = { ...state, ...partialState };
  const nextRoute = routeOrchestrator(nextState);
  const nextTaskType = getOrchestratorNextTaskType(nextRoute);

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
