import { ChatOpenAI } from "@langchain/openai";

const DEFAULT_MODEL = "openai/gpt-4o";

export interface LLMConfig {
  model?: string;
  temperature?: number;
  apiKey?: string;
}

export type ChatModel = ChatOpenAI;

/**
 * Create LLM client using OpenRouter only (https://openrouter.ai/docs/quickstart).
 * All chat/completions go through OpenRouter; model is OpenRouter model id (e.g. openai/gpt-4o).
 */
export function createLLM(config: LLMConfig = {}): ChatModel {
  const {
    model = process.env.LLM_MODEL || DEFAULT_MODEL,
    temperature = 0.7,
    apiKey,
  } = config;

  return new ChatOpenAI({
    modelName: model,
    temperature,
    openAIApiKey: apiKey || process.env.OPENROUTER_API_KEY,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "",
        "X-Title": "Decisium",
      },
    },
  });
}

export function getDefaultLLM(): ChatModel {
  const model = process.env.LLM_MODEL;
  return createLLM({ model: model || undefined });
}
