import { createLLM } from "./llm";
import type { LLMProvider } from "./llm";
import { getCurrentDate, getCurrentDateWithDay } from "./date-utils";

export function createDeepAgentConfig(config?: {
  llmProvider?: "openai" | "anthropic" | "openrouter";
  model?: string;
  temperature?: number;
  systemPrompt?: string;
}): { llm: ReturnType<typeof createLLM>; systemPrompt: string } {
  const provider = (config?.llmProvider ||
    (process.env.LLM_PROVIDER as LLMProvider) ||
    "anthropic") as LLMProvider;
  const model = config?.model || process.env.LLM_MODEL;
  const temperature = config?.temperature ?? 0.7;

  const llm = createLLM({
    provider,
    model: model || undefined,
    temperature,
  });

  // Get current date with day of week and prepend as top layer
  const currentDate = getCurrentDate();
  const currentDateWithDay = getCurrentDateWithDay();
  const dateLayer = `Current Date: ${currentDateWithDay} (${currentDate})\n\n`;
  const systemPrompt = config?.systemPrompt || "";
  const finalSystemPrompt = dateLayer + systemPrompt;

  return {
    llm,
    systemPrompt: finalSystemPrompt,
  };
}
