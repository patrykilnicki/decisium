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
import type { DailyGraphState } from "@/packages/agents/core/daily.agent";
import {
  classifierAgentNode,
  dailyResponseAgentNode,
  memoryRetrieverNode as dailyMemoryRetrieverNode,
  noteAcknowledgmentNode,
  routeAfterClassifier,
  saveEventsNode,
  suggestAskAiNode,
} from "@/packages/agents/core/daily.agent";
import type {
  TaskExecutionResult,
  TaskInsert,
  TaskRow,
} from "@/lib/tasks/task-types";
import type { TaskType } from "@/lib/tasks/task-definitions";
import type { Json } from "@/types/supabase";

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

function getDailyNextTaskType(route: string): TaskType | null {
  switch (route) {
    case "noteAcknowledgment":
      return "daily.note_acknowledgment";
    case "memoryRetriever":
      return "daily.memory_retriever";
    case "suggestAskAi":
      return "daily.suggest_ask_ai";
    default:
      return null;
  }
}

export async function handleTask(task: TaskRow): Promise<TaskExecutionResult> {
  const taskType = task.task_type as TaskType;
  if (taskType.startsWith("root.")) {
    return handleRootTask(task, taskType);
  }
  if (taskType.startsWith("orchestrator.")) {
    return handleOrchestratorTask(task, taskType);
  }
  return handleDailyTask(task, taskType);
}

async function handleRootTask(
  task: TaskRow,
  taskType: TaskType,
): Promise<TaskExecutionResult> {
  const state = getTaskState<RootGraphState>(task);
  let partialState: Partial<RootGraphState> = {};

  switch (taskType) {
    case "root.save_user_message":
      partialState = await saveUserMessageNode(state);
      break;
    case "root.memory_retriever":
      partialState = await memoryRetrieverNode(state);
      break;
    case "root.response_agent":
      partialState = await rootResponseAgentNode(state);
      break;
    case "root.save_assistant_message":
      partialState = await saveAssistantMessageNode(state);
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
): Promise<TaskExecutionResult> {
  const state = getTaskState<OrchestratorState>(task);
  let partialState: Partial<OrchestratorState> = {};

  switch (taskType) {
    case "orchestrator.router":
      partialState = await routerNode(state);
      break;
    case "orchestrator.tool_executor":
      partialState = await toolExecutorNode(state);
      break;
    case "orchestrator.grade_documents":
      partialState = await gradeDocsNode(state);
      break;
    case "orchestrator.rewrite_query":
      partialState = await rewriteNode(state);
      break;
    case "orchestrator.synthesize":
      partialState = await synthesizeNode(state);
      break;
    case "orchestrator.save_messages":
      partialState = await saveMessagesNode(state);
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

async function handleDailyTask(
  task: TaskRow,
  taskType: TaskType,
): Promise<TaskExecutionResult> {
  const state = getTaskState<DailyGraphState>(task);
  let partialState: Partial<DailyGraphState> = {};

  switch (taskType) {
    case "daily.classifier_agent":
      partialState = await classifierAgentNode(state);
      break;
    case "daily.memory_retriever":
      partialState = await dailyMemoryRetrieverNode(state);
      break;
    case "daily.response_agent":
      partialState = await dailyResponseAgentNode(state);
      break;
    case "daily.note_acknowledgment":
      partialState = noteAcknowledgmentNode(state);
      break;
    case "daily.suggest_ask_ai":
      partialState = suggestAskAiNode(state);
      break;
    case "daily.save_events":
      partialState = await saveEventsNode(state);
      break;
  }

  const nextState: DailyGraphState = { ...state, ...partialState };

  if (taskType === "daily.classifier_agent") {
    const nextRoute = routeAfterClassifier(nextState);
    const nextTaskType = getDailyNextTaskType(nextRoute);
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

  if (taskType === "daily.memory_retriever") {
    return {
      output: { state: nextState },
      nextTasks: [
        buildNextTask({
          parentTaskId: task.id,
          userId: task.user_id,
          sessionId: task.session_id,
          taskType: "daily.response_agent",
          state: nextState,
        }),
      ],
    };
  }

  if (
    taskType === "daily.response_agent" ||
    taskType === "daily.note_acknowledgment" ||
    taskType === "daily.suggest_ask_ai"
  ) {
    return {
      output: { state: nextState },
      nextTasks: [
        buildNextTask({
          parentTaskId: task.id,
          userId: task.user_id,
          sessionId: task.session_id,
          taskType: "daily.save_events",
          state: nextState,
        }),
      ],
    };
  }

  return { output: { state: nextState } };
}
