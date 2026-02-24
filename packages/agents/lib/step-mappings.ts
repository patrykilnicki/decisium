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
// Uses Composio agent-tools-agent loop: single orchestrator.invoke task
export const ORCHESTRATOR_STEPS: StepMapping[] = [
  { nodeId: "orchestrator", label: "Processing with AI", order: 1 },
];

export function getStepLabel(
  nodeId: string,
  mode: "linear" | "agentic",
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

  if (graph === "orchestrator") {
    return (
      ORCHESTRATOR_STEPS.find((step) => step.nodeId === nodeId)?.label ?? nodeId
    );
  }

  return (
    ROOT_AGENT_STEPS.find((step) => step.nodeId === nodeId)?.label ?? nodeId
  );
}

function humanizeToolName(toolName: string): string {
  return toolName
    .trim()
    .replace(/^composio[_-]?/i, "")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

function toTitleCase(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildToolLabel(
  eventType: string,
  toolName: string,
  action?: string,
): string {
  const normalizedTool = toTitleCase(humanizeToolName(toolName));
  const normalizedAction = action?.trim().toLowerCase();

  if (normalizedAction)
    return `${toTitleCase(normalizedAction)} ${normalizedTool}`;

  if (eventType === "tool_started") return `Checking ${normalizedTool}`;
  if (eventType === "tool_completed") return `Completed ${normalizedTool}`;
  if (eventType === "tool_failed") return `Failed ${normalizedTool}`;

  return `Using ${normalizedTool}`;
}

export function getDynamicStepLabel(params: {
  eventType: string;
  fallbackLabel: string;
  payload?: Record<string, unknown>;
}): string {
  const payload = params.payload ?? {};
  const displayLabel = payload.displayLabel;
  if (typeof displayLabel === "string" && displayLabel.trim().length > 0) {
    return displayLabel;
  }

  const toolName = payload.toolName;
  const action = payload.action;
  if (typeof toolName === "string" && toolName.trim().length > 0) {
    return buildToolLabel(
      params.eventType,
      toolName,
      typeof action === "string" ? action : undefined,
    );
  }

  return params.fallbackLabel;
}
