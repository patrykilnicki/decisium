import { createDeepAgent } from "deepagents";
import { createDeepAgentConfig } from "./deepagent-config";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { getToolsForAgent, type AgentType } from "../tools/registry";
import { getCurrentDate } from "./date-utils";

export interface BaseAgentConfig {
  llmProvider?: "openai" | "anthropic" | "openrouter";
  model?: string;
  temperature?: number;
  systemPrompt: string;
  agentType?: AgentType;
  tools?: DynamicStructuredTool[];
  excludeTools?: string[];
  currentDate?: string;
  // Allow date template replacement in system prompt
  replaceDateTemplate?: boolean;
}

/**
 * Create a base agent with shared configuration
 * This is the primary factory function for creating agents
 *
 * @returns An agent instance (typed as unknown to avoid deep type inference issues with LangChain types)
 */
export function createBaseAgent(config: BaseAgentConfig): unknown {
  const {
    systemPrompt,
    agentType,
    tools: customTools,
    excludeTools,
    currentDate,
    replaceDateTemplate = true,
    ...llmConfig
  } = config;

  // Get current date if not provided
  const date = currentDate || getCurrentDate();

  // Replace date template in system prompt if enabled
  const processedSystemPrompt = replaceDateTemplate
    ? systemPrompt.replace(/{{currentDate}}/g, date)
    : systemPrompt;

  // Get tools for agent type, or use custom tools
  const tools =
    customTools ||
    (agentType
      ? getToolsForAgent(agentType, { excludeTools })
      : getToolsForAgent("root", { excludeTools }));

  // Create LLM and system prompt config
  const { llm, systemPrompt: finalSystemPrompt } = createDeepAgentConfig({
    ...llmConfig,
    systemPrompt: processedSystemPrompt,
  });

  // Create and return the agent
  return createDeepAgent({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deepagents expects LangChain types
    model: llm as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deepagents expects LangChain types
    tools: tools as any,
    systemPrompt: finalSystemPrompt,
  });
}

/**
 * Create a simple agent without tools (for system messages, classifiers, etc.)
 *
 * @returns An agent instance (typed as unknown to avoid deep type inference issues with LangChain types)
 */
export function createSimpleAgent(config: {
  systemPrompt: string;
  temperature?: number;
  llmProvider?: "openai" | "anthropic" | "openrouter";
  model?: string;
  currentDate?: string;
}): unknown {
  return createBaseAgent({
    ...config,
    agentType: "system",
    tools: [], // No tools for simple agents (explicitly set to override agentType defaults)
  });
}

/**
 * Create an agent with custom tools
 *
 * @returns An agent instance (typed as unknown to avoid deep type inference issues with LangChain types)
 */
export function createAgentWithTools(
  systemPrompt: string,
  tools: DynamicStructuredTool[],
  config?: {
    temperature?: number;
    llmProvider?: "openai" | "anthropic" | "openrouter";
    model?: string;
    currentDate?: string;
  }
): unknown {
  return createBaseAgent({
    systemPrompt,
    tools,
    ...config,
  });
}
