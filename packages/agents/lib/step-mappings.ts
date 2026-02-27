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
  { nodeId: "orchestrator", label: "Thinking...", order: 1 },
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

const FRIENDLY_TOOL_LABELS: Record<
  string,
  { started: string; completed: string; failed: string }
> = {
  COMPOSIO_SEARCH_TOOLS: {
    started: "Preparing...",
    completed: "Prepared",
    failed: "Preparation failed",
  },
  COMPOSIO_MANAGE_CONNECTIONS: {
    started: "Setting up connection...",
    completed: "Connection ready",
    failed: "Connection failed",
  },
  COMPOSIO_REMOTE_WORKBENCH: {
    started: "Processing data...",
    completed: "Data processed",
    failed: "Data processing failed",
  },
  memory_search: {
    started: "Checking memory...",
    completed: "Memory checked",
    failed: "Memory check failed",
  },
  generate_todo_list: {
    started: "Generating tasks from integrations...",
    completed: "Tasks generated",
    failed: "Task generation failed",
  },
};

const SERVICE_LABELS: Record<
  string,
  { started: string; completed: string; failed: string }
> = {
  GMAIL: {
    started: "Checking Gmail...",
    completed: "Gmail checked",
    failed: "Gmail check failed",
  },
  GOOGLECALENDAR: {
    started: "Checking Calendar...",
    completed: "Calendar checked",
    failed: "Calendar check failed",
  },
};

function detectServiceFromInnerTools(innerToolSlugs: string[]): string | null {
  for (const slug of innerToolSlugs) {
    const upper = slug.toUpperCase();
    if (upper.startsWith("GMAIL")) return "GMAIL";
    if (upper.startsWith("GOOGLECALENDAR")) return "GOOGLECALENDAR";
  }
  return null;
}

export function getFriendlyToolLabel(
  eventType: string,
  toolName: string,
  innerToolSlugs?: string[],
): string {
  const stateKey =
    eventType === "tool_started"
      ? "started"
      : eventType === "tool_completed"
        ? "completed"
        : eventType === "tool_failed"
          ? "failed"
          : "started";

  if (toolName === "COMPOSIO_MULTI_EXECUTE_TOOL" && innerToolSlugs?.length) {
    const service = detectServiceFromInnerTools(innerToolSlugs);
    if (service && SERVICE_LABELS[service]) {
      return SERVICE_LABELS[service][stateKey];
    }
  }

  const directMatch = FRIENDLY_TOOL_LABELS[toolName];
  if (directMatch) return directMatch[stateKey];

  return stateKey === "started"
    ? "Checking..."
    : stateKey === "completed"
      ? "Done"
      : "Failed";
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
  if (typeof toolName === "string" && toolName.trim().length > 0) {
    const innerToolSlugs = payload.innerToolSlugs;
    return getFriendlyToolLabel(
      params.eventType,
      toolName,
      Array.isArray(innerToolSlugs) ? (innerToolSlugs as string[]) : undefined,
    );
  }

  return params.fallbackLabel;
}
