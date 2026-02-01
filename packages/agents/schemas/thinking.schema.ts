// Step status states
export type ThinkingStepStatus = "pending" | "running" | "completed" | "error";

// Individual step in the thinking process
export interface ThinkingStep {
  stepId: string;
  label: string;
  status: ThinkingStepStatus;
  timestamp?: number;
}

// SSE event types (inspired by AG-UI protocol)
export type ThinkingEventType =
  | "run_started"
  | "step_started"
  | "step_completed"
  | "step_error"
  | "message_content"
  | "run_finished"
  | "run_error";

// SSE event payload
export interface ThinkingEvent {
  type: ThinkingEventType;
  stepId?: string;
  label?: string;
  content?: string;
  error?: string;
  timestamp: number;
}

// Node to step mapping configuration
export interface StepMapping {
  nodeId: string;
  label: string;
  order: number;
}
