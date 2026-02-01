import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { createLLM, type LLMConfig, type ChatModel } from "./llm";
import { getCurrentDate } from "./date-utils";
import { ROUTER_SYSTEM_PROMPT } from "../prompts";

export interface RouterConfig {
  llmProvider?: "openai" | "anthropic" | "openrouter";
  model?: string;
  temperature?: number;
  currentDate?: string;
}

export interface RouterAgent {
  llm: ChatModel;
  llmWithTools: ReturnType<ChatModel["bindTools"]>;
  systemPrompt: string;
}

/**
 * Create a router agent that uses bindTools pattern for autonomous tool selection
 * The router decides WHICH tools to call based on the user's request
 */
export function createRouterAgent(
  tools: DynamicStructuredTool[],
  config?: RouterConfig
): RouterAgent {
  const provider = config?.llmProvider || 
    (process.env.LLM_PROVIDER as "openai" | "anthropic" | "openrouter") || 
    "anthropic";
  
  const currentDate = config?.currentDate || getCurrentDate();
  const systemPrompt = ROUTER_SYSTEM_PROMPT.replace(/{{currentDate}}/g, currentDate);
  
  const llm = createLLM({
    provider,
    model: config?.model,
    temperature: config?.temperature ?? 0.1, // Lower temperature for routing decisions
  });

  // Bind tools to the LLM for autonomous selection
  const llmWithTools = llm.bindTools(tools);

  return {
    llm,
    llmWithTools,
    systemPrompt,
  };
}

/**
 * Check if the LLM response contains tool calls
 */
export function hasToolCalls(response: any): boolean {
  return (
    response?.tool_calls &&
    Array.isArray(response.tool_calls) &&
    response.tool_calls.length > 0
  );
}

/**
 * Extract tool calls from LLM response
 */
export function extractToolCalls(response: any): Array<{
  name: string;
  args: Record<string, any>;
  id: string;
}> {
  if (!hasToolCalls(response)) {
    return [];
  }

  return response.tool_calls.map((call: any) => ({
    name: call.name,
    args: call.args || {},
    id: call.id || `call_${Date.now()}`,
  }));
}

/**
 * Create tool definitions for binding (simplified schema format)
 */
export function getToolDefinitions(tools: DynamicStructuredTool[]): Array<{
  name: string;
  description: string;
  schema: any;
}> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
  }));
}
