import { createLLM } from "./llm";
import {
  getCurrentDate,
  getCurrentDateWithDay,
  getFormattedDateWithDay,
} from "./date-utils";

export function createDeepAgentConfig(config?: {
  model?: string;
  temperature?: number;
  systemPrompt?: string;
  /** When provided (e.g. from user context), used for the date layer instead of UTC */
  currentDate?: string;
}): { llm: ReturnType<typeof createLLM>; systemPrompt: string } {
  const model = config?.model || process.env.LLM_MODEL;
  const temperature = config?.temperature ?? 0.7;

  const llm = createLLM({
    model: model || undefined,
    temperature,
  });

  const currentDate = config?.currentDate ?? getCurrentDate();
  const currentDateWithDay = config?.currentDate
    ? getFormattedDateWithDay(config.currentDate)
    : getCurrentDateWithDay();
  const dateLayer = `Current Date: ${currentDateWithDay} (${currentDate})\n\n`;
  const systemPrompt = config?.systemPrompt || "";
  const finalSystemPrompt = dateLayer + systemPrompt;

  return {
    llm,
    systemPrompt: finalSystemPrompt,
  };
}
