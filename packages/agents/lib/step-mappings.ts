import { StepMapping } from "../schemas/thinking.schema";
import type { TaskType } from "@/lib/tasks/task-definitions";
import { getTaskGraph, getTaskNodeId } from "@/lib/tasks/task-definitions";

// Root agent (linear mode) step mappings
export const ROOT_AGENT_STEPS: StepMapping[] = [
  { nodeId: "saveUserMessage", label: "Processing your message", order: 1 },
  { nodeId: "memoryRetriever", label: "Searching memories", order: 2 },
  { nodeId: "rootResponseAgent", label: "Generating response", order: 3 },
  { nodeId: "saveAssistantMessage", label: "Saving response", order: 4 },
];

// Orchestrator agent (agentic mode) step mappings
export const ORCHESTRATOR_STEPS: StepMapping[] = [
  { nodeId: "router", label: "Analyzing your request", order: 1 },
  { nodeId: "toolExecutor", label: "Gathering information", order: 2 },
  { nodeId: "gradeDocuments", label: "Evaluating results", order: 3 },
  { nodeId: "rewriteQuery", label: "Refining search", order: 4 },
  { nodeId: "synthesize", label: "Crafting response", order: 5 },
  { nodeId: "saveMessages", label: "Saving conversation", order: 6 },
];

export const DAILY_STEPS: StepMapping[] = [
  { nodeId: "classifierAgent", label: "Understanding your note", order: 1 },
  { nodeId: "memoryRetriever", label: "Searching memories", order: 2 },
  { nodeId: "dailyResponseAgent", label: "Generating response", order: 3 },
  { nodeId: "noteAcknowledgment", label: "Acknowledging note", order: 3 },
  { nodeId: "suggestAskAi", label: "Suggesting deeper analysis", order: 3 },
  { nodeId: "saveEvents", label: "Saving updates", order: 4 },
];

export function getStepLabel(
  nodeId: string,
  mode: "linear" | "agentic"
): string {
  const steps = mode === "agentic" ? ORCHESTRATOR_STEPS : ROOT_AGENT_STEPS;
  return steps.find((s) => s.nodeId === nodeId)?.label ?? nodeId;
}

export function getOrderedSteps(mode: "linear" | "agentic"): StepMapping[] {
  const steps = mode === "agentic" ? ORCHESTRATOR_STEPS : ROOT_AGENT_STEPS;
  return [...steps].sort((a, b) => a.order - b.order);
}

export function getTaskStepLabel(taskType: TaskType): string {
  const graph = getTaskGraph(taskType);
  const nodeId = getTaskNodeId(taskType);

  if (graph === "daily") {
    return DAILY_STEPS.find((step) => step.nodeId === nodeId)?.label ?? nodeId;
  }

  if (graph === "orchestrator") {
    return ORCHESTRATOR_STEPS.find((step) => step.nodeId === nodeId)?.label ?? nodeId;
  }

  return ROOT_AGENT_STEPS.find((step) => step.nodeId === nodeId)?.label ?? nodeId;
}
