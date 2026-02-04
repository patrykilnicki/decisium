import type { DynamicStructuredTool } from "@langchain/core/tools";
import { createLLM, type ChatModel } from "./llm";
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

interface ToolCallResponse {
  tool_calls?: Array<{ name?: string; args?: Record<string, unknown>; id?: string }>;
}

/**
 * Check if the LLM response contains tool calls
 */
export function hasToolCalls(response: unknown): boolean {
  const r = response as ToolCallResponse;
  return (
    r?.tool_calls &&
    Array.isArray(r.tool_calls) &&
    r.tool_calls.length > 0
  );
}

/**
 * Extract tool calls from LLM response
 */
export function extractToolCalls(response: unknown): Array<{
  name: string;
  args: Record<string, unknown>;
  id: string;
}> {
  if (!hasToolCalls(response)) {
    return [];
  }

  const r = response as ToolCallResponse;
  return (r.tool_calls ?? []).map((call: { name?: string; args?: Record<string, unknown>; id?: string }) => ({
    name: call.name ?? "",
    args: call.args ?? {},
    id: call.id ?? `call_${Date.now()}`,
  }));
}

/**
 * Create tool definitions for binding (simplified schema format)
 */
export function getToolDefinitions(tools: DynamicStructuredTool[]): Array<{
  name: string;
  description: string;
  schema: unknown;
}> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
  }));
}
