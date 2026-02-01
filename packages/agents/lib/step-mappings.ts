import { StepMapping } from "../schemas/thinking.schema";

// Root agent (linear mode) step mappings
export const ROOT_AGENT_STEPS: StepMapping[] = [
  { nodeId: "saveUserMessage", label: "Processing your message", order: 1 },
  { nodeId: "memoryRetriever", label: "Searching memories", order: 2 },
  { nodeId: "rootResponseAgent", label: "Generating response", order: 3 },
  { nodeId: "saveAssistantMessage", label: "Saving response", order: 4 },
];

// Orchestrator agent (agentic mode) step mappings
export const ORCHESTRATOR_STEPS: StepMapping[] = [
  { nodeId: "saveUserMessage", label: "Processing your message", order: 1 },
  { nodeId: "router", label: "Analyzing your request", order: 2 },
  { nodeId: "toolExecutor", label: "Gathering information", order: 3 },
  { nodeId: "gradeDocuments", label: "Evaluating results", order: 4 },
  { nodeId: "rewriteQuery", label: "Refining search", order: 5 },
  { nodeId: "synthesize", label: "Crafting response", order: 6 },
  { nodeId: "saveMessages", label: "Saving conversation", order: 7 },
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
