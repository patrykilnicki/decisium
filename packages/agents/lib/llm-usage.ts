import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase";
import type { AgentLlmUsageInsert } from "@/types/database";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTaskContext } from "./task-context";

interface ExtractedUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
  provider?: string;
  usageMetadata: Record<string, unknown>;
}

interface LlmModelPrice {
  inputCostPer1k: number;
  outputCostPer1k: number;
  currency: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function pickFirstObject(
  ...candidates: Array<unknown>
): Record<string, unknown> | undefined {
  for (const candidate of candidates) {
    if (isRecord(candidate)) return candidate;
  }
  return undefined;
}

function extractUsageFromCandidate(candidate: unknown): ExtractedUsage | null {
  if (!isRecord(candidate)) return null;

  const lcKwargs =
    candidate.lc_kwargs && isRecord(candidate.lc_kwargs)
      ? candidate.lc_kwargs
      : undefined;
  const lcResponseMeta =
    lcKwargs?.response_metadata && isRecord(lcKwargs.response_metadata)
      ? lcKwargs.response_metadata
      : undefined;
  const responseMetadata = isRecord(candidate.response_metadata)
    ? candidate.response_metadata
    : lcResponseMeta;
  const usageMetadata =
    pickFirstObject(
      candidate.usage_metadata,
      responseMetadata?.usage,
      responseMetadata?.usage_metadata,
      candidate.usage,
      candidate.token_usage,
      candidate.metadata && isRecord(candidate.metadata)
        ? candidate.metadata.usage_metadata
        : undefined,
      candidate.kwargs && isRecord(candidate.kwargs)
        ? candidate.kwargs.usage_metadata
        : undefined,
      lcKwargs?.usage_metadata,
      lcResponseMeta?.usage,
      lcResponseMeta?.usage_metadata,
    ) ?? {};

  if (Object.keys(usageMetadata).length === 0) return null;

  const inputTokens =
    toNumber(usageMetadata.input_tokens) ??
    toNumber(usageMetadata.prompt_tokens) ??
    toNumber(usageMetadata.inputTokens);
  const outputTokens =
    toNumber(usageMetadata.output_tokens) ??
    toNumber(usageMetadata.completion_tokens) ??
    toNumber(usageMetadata.outputTokens);
  const totalTokens =
    toNumber(usageMetadata.total_tokens) ??
    toNumber(usageMetadata.totalTokens) ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);

  const model =
    toString(responseMetadata?.model) ??
    toString(responseMetadata?.model_name) ??
    toString(responseMetadata?.modelName) ??
    toString(responseMetadata?.model_id) ??
    toString(responseMetadata?.modelId) ??
    toString(candidate.model) ??
    toString(candidate.modelName) ??
    (candidate.kwargs && isRecord(candidate.kwargs)
      ? toString(candidate.kwargs.model)
      : undefined) ??
    (lcKwargs ? toString(lcKwargs.model ?? lcKwargs.model_name) : undefined);

  const provider =
    toString(responseMetadata?.provider) ??
    toString(responseMetadata?.llm_provider) ??
    toString(candidate.provider) ??
    (lcKwargs ? toString(lcKwargs.provider) : undefined);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    model,
    provider,
    usageMetadata,
  };
}

function extractUsageFromResponse(response: unknown): ExtractedUsage | null {
  const direct = extractUsageFromCandidate(response);
  if (direct) return direct;

  if (isRecord(response) && Array.isArray(response.messages)) {
    const lastMessage = response.messages[response.messages.length - 1];
    return extractUsageFromCandidate(lastMessage);
  }

  if (Array.isArray(response)) {
    const lastMessage = response[response.length - 1];
    return extractUsageFromCandidate(lastMessage);
  }

  return null;
}

/** Zwraca provider (z odpowiedzi lub env), znormalizowany do lowercase pod kątem zapytania do llm_model_prices */
function resolveProvider(provider?: string): string | undefined {
  const raw =
    (typeof provider === "string" && provider.trim() !== ""
      ? provider
      : null) ??
    (typeof process.env.LLM_PROVIDER === "string" &&
    process.env.LLM_PROVIDER.trim() !== ""
      ? process.env.LLM_PROVIDER
      : null);
  return raw ? raw.toLowerCase().trim() : undefined;
}

/** Domyślne modele w llm_model_prices (zgodne z packages/agents/lib/llm.ts) */
const DEFAULT_MODELS_BY_PROVIDER: Record<string, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  openrouter: "openai/gpt-4-turbo",
};

/** Zwraca model (z odpowiedzi, env lub domyślny dla providera) do dopasowania w llm_model_prices */
function resolveModel(model?: string, provider?: string): string | undefined {
  const raw =
    (typeof model === "string" && model.trim() !== "" ? model : null) ??
    (typeof process.env.LLM_MODEL === "string" &&
    process.env.LLM_MODEL.trim() !== ""
      ? process.env.LLM_MODEL
      : null);
  if (raw) return raw.trim();
  if (provider)
    return DEFAULT_MODELS_BY_PROVIDER[provider.toLowerCase()] ?? undefined;
  return undefined;
}

async function fetchModelPrice(params: {
  client: SupabaseClient<Database>;
  provider?: string;
  model?: string;
}): Promise<LlmModelPrice | null> {
  if (!params.provider) return null;

  // 1. Dokładne dopasowanie provider + model
  if (params.model) {
    const { data, error } = await params.client
      .from("llm_model_prices")
      .select("input_cost_per_1k, output_cost_per_1k, currency")
      .eq("provider", params.provider)
      .eq("model", params.model)
      .eq("active", true)
      .maybeSingle();

    if (!error && data) {
      return {
        inputCostPer1k: Number(data.input_cost_per_1k),
        outputCostPer1k: Number(data.output_cost_per_1k),
        currency: data.currency,
      };
    }
  }

  // 2. Fallback: pierwsza aktywna cena dla providera (gdy model nie pasuje lub brak w odpowiedzi)
  const { data: fallbackData, error: fallbackError } = await params.client
    .from("llm_model_prices")
    .select("input_cost_per_1k, output_cost_per_1k, currency, model")
    .eq("provider", params.provider)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (!fallbackError && fallbackData) {
    return {
      inputCostPer1k: Number(fallbackData.input_cost_per_1k),
      outputCostPer1k: Number(fallbackData.output_cost_per_1k),
      currency: fallbackData.currency,
    };
  }

  return null;
}

/**
 * Oblicza szacowany koszt w USD na podstawie liczby tokenów i ceny modelu
 *
 * @param params - Parametry do obliczenia kosztu
 * @returns Szacowany koszt w USD lub null jeśli nie można obliczyć
 *
 * Formuła:
 * - inputCost = (inputTokens / 1000) * inputCostPer1k
 * - outputCost = (outputTokens / 1000) * outputCostPer1k
 * - totalCost = inputCost + outputCost
 */
function calculateEstimatedCostUsd(params: {
  inputTokens?: number;
  outputTokens?: number;
  price?: LlmModelPrice | null;
}): number | null {
  if (!params.price) return null;
  if (params.price.currency !== "USD") return null;

  const inputTokens = params.inputTokens ?? 0;
  const outputTokens = params.outputTokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return null;

  // Oblicz koszt dla input tokens
  const inputCost = (inputTokens / 1000) * params.price.inputCostPer1k;
  // Oblicz koszt dla output tokens
  const outputCost = (outputTokens / 1000) * params.price.outputCostPer1k;
  // Zwróć sumę kosztów zaokrągloną do 6 miejsc po przecinku
  return Number((inputCost + outputCost).toFixed(6));
}

/**
 * Loguje użycie LLM do bazy danych z obliczonym kosztem
 *
 * Opcja A (zalecane): Oblicza koszt przed zapisem na podstawie:
 * - provider i model (do pobrania ceny z llm_model_prices)
 * - input_tokens i output_tokens (z odpowiedzi LLM)
 *
 * Zapisuje do tabeli agent_llm_usage z polami:
 * - user_id, task_id, session_id, task_type, node_key
 * - provider, model, input_tokens, output_tokens, total_tokens
 * - estimated_cost_usd (obliczony koszt w USD)
 * - usage_metadata (dodatkowe metadane)
 */
export async function logLlmUsage(params: {
  response: unknown;
  userId?: string;
  agentType: string;
  client?: SupabaseClient<Database>;
  taskId?: string | null;
  sessionId?: string | null;
  taskType?: string | null;
  nodeKey?: string | null;
}): Promise<void> {
  try {
    const usage = extractUsageFromResponse(params.response);
    if (!usage) return;

    const context = getTaskContext();
    const userId = params.userId ?? context?.userId;
    if (!userId) return;

    const client = params.client ?? createAdminClient();
    // Provider i model z odpowiedzi lub z env / domyślne – żeby zawsze móc dopasować cenę w llm_model_prices
    const provider = resolveProvider(usage.provider);
    const model = resolveModel(usage.model, provider);

    // Pobierz cenę modelu z bazy danych (provider/model znormalizowane)
    const price = await fetchModelPrice({
      client,
      provider,
      model,
    });

    // Oblicz koszt przed zapisem (zalecane - Opcja A)
    const estimatedCostUsd = calculateEstimatedCostUsd({
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      price,
    });

    // Loguj informacje gdy nie można obliczyć kosztu (dla debugowania)
    if (estimatedCostUsd === null) {
      if (!price) {
        console.warn(
          `[logLlmUsage] No price found for provider="${provider}", model="${model}". Cost will be null. Add row to llm_model_prices or set LLM_PROVIDER/LLM_MODEL.`,
        );
      } else if (price.currency !== "USD") {
        console.warn(
          `[logLlmUsage] Price currency is "${price.currency}", not USD. Cost will be null.`,
        );
      } else if (
        (usage.inputTokens ?? 0) === 0 &&
        (usage.outputTokens ?? 0) === 0
      ) {
        console.warn(
          `[logLlmUsage] No tokens found (input=${usage.inputTokens}, output=${usage.outputTokens}). Cost will be null.`,
        );
      }
    }

    const insert: AgentLlmUsageInsert = {
      user_id: userId,
      task_id: params.taskId ?? context?.taskId ?? null,
      session_id: params.sessionId ?? context?.sessionId ?? null,
      task_type: params.taskType ?? context?.taskType ?? null,
      node_key: params.nodeKey ?? context?.nodeKey ?? null,
      agent_type: params.agentType,
      provider: provider ?? null,
      model: model ?? usage.model ?? null,
      input_tokens: usage.inputTokens ?? null,
      output_tokens: usage.outputTokens ?? null,
      total_tokens: usage.totalTokens ?? null,
      estimated_cost_usd: estimatedCostUsd, // ✅ Zapisuj obliczony koszt
      usage_metadata: usage.usageMetadata as Json,
    };

    const { error } = await client.from("agent_llm_usage").insert(insert);
    if (error) {
      console.error("[logLlmUsage] Failed to store usage:", error.message);
    }
  } catch (error) {
    console.error("[logLlmUsage] Error logging usage:", error);
  }
}
