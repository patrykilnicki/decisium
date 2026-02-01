import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";

export type LLMProvider = "openai" | "anthropic" | "openrouter";

export interface LLMConfig {
  provider: LLMProvider;
  model?: string;
  temperature?: number;
  apiKey?: string;
}

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  openrouter: "openai/gpt-4-turbo",
};

export type ChatModel = ChatOpenAI | ChatAnthropic;

export function createLLM(config: LLMConfig): ChatModel {
  const {
    provider,
    model = DEFAULT_MODELS[provider],
    temperature = 0.7,
    apiKey,
  } = config;

  switch (provider) {
    case "openai": {
      return new ChatOpenAI({
        modelName: model,
        temperature,
        openAIApiKey: apiKey || process.env.OPENAI_API_KEY,
      });
    }
    case "anthropic": {
      return new ChatAnthropic({
        modelName: model,
        temperature,
        anthropicApiKey: apiKey || process.env.ANTHROPIC_API_KEY,
      });
    }
    case "openrouter": {
      // OpenRouter uses OpenAI-compatible API
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
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

export function getDefaultLLM(): ChatModel {
  const provider = (process.env.LLM_PROVIDER || "anthropic") as LLMProvider;
  const model = process.env.LLM_MODEL;
  return createLLM({ provider, model: model || undefined });
}
