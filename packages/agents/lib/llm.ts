import { ChatOpenAI } from "@langchain/openai";

const DEFAULT_MODEL = "openai/gpt-4o";

export interface LLMConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
}

export type ChatModel = ChatOpenAI;

/**
 * Create LLM client using OpenRouter only (https://openrouter.ai/docs/quickstart).
 * All chat/completions go through OpenRouter; model is OpenRouter model id (e.g. openai/gpt-4o).
 */
const OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY";

export function createLLM(config: LLMConfig = {}): ChatModel {
  const {
    model = process.env.LLM_MODEL || DEFAULT_MODEL,
    temperature = 0.7,
    maxTokens,
    apiKey,
  } = config;

  const resolvedKey = apiKey ?? process.env[OPENROUTER_API_KEY_ENV];
  if (!resolvedKey || resolvedKey.trim() === "") {
    throw new Error(
      `Missing API key for LLM: set ${OPENROUTER_API_KEY_ENV} in the environment where the agent runs (e.g. .env.local for Next.js, or worker/cron env). See https://docs.langchain.com/oss/javascript/langchain/errors/MODEL_AUTHENTICATION/`,
    );
  }

  return new ChatOpenAI({
    modelName: model,
    temperature,
    ...(maxTokens != null && { maxTokens }),
    // ChatOpenAI reads apiKey from configuration (or fields.apiKey), not openAIApiKey when using custom baseURL
    configuration: {
      apiKey: resolvedKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        Authorization: `Bearer ${resolvedKey}`,
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
