// Main exports
export * from "./schemas/daily.schema";
export * from "./schemas/summary.schema";
export * from "./schemas/ask.schema";
export * from "./schemas/memory.schema";
export * from "./schemas/orchestrator.schema";
export * from "./schemas/main.schema";
export * from "./lib/llm";
export * from "./lib/embeddings";
export * from "./lib/deepagent-config";

// Shared utilities
export * from "./lib/auth";
export * from "./lib/date-utils";
export * from "./lib/context";
export * from "./lib/error-handler";
export * from "./lib/agent-base";
export * from "./lib/router";

// Prompts
export * from "./prompts";

// Nodes (for custom graph construction)
export * from "./nodes";

// Tools
export * from "./tools/registry";
export * from "./tools";

// Agent exports
export * from "./core/root.agent";
export * from "./core/orchestrator.agent";
export * from "./core/main.agent";

// Export daily agent types explicitly to avoid DailyEvent conflict
// DailyEvent from schema is the canonical type, daily.agent extends it
export type {
  ClassificationResult,
  DailyWelcomeResult,
  DailyMessageResult,
} from "./core/daily.agent";
export {
  createDailyInitGraph,
} from "./core/daily.agent";
