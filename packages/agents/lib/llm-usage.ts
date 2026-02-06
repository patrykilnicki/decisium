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

  const responseMetadata = isRecord(candidate.response_metadata)
    ? candidate.response_metadata
    : undefined;

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
      : undefined);

  const provider =
    toString(responseMetadata?.provider) ??
    toString(responseMetadata?.llm_provider) ??
    toString(candidate.provider);

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

function resolveProvider(provider?: string): string | undefined {
  if (provider) return provider;
  const envProvider = process.env.LLM_PROVIDER;
  return typeof envProvider === "string" && envProvider.trim() !== ""
    ? envProvider
    : undefined;
}

async function fetchModelPrice(params: {
  client: SupabaseClient<Database>;
  provider?: string;
  model?: string;
}): Promise<LlmModelPrice | null> {
  if (!params.provider || !params.model) return null;

  const { data, error } = await params.client
    .from("llm_model_prices")
    .select("input_cost_per_1k, output_cost_per_1k, currency")
    .eq("provider", params.provider)
    .eq("model", params.model)
    .eq("active", true)
    .maybeSingle();

  if (error || !data) return null;

  return {
    inputCostPer1k: Number(data.input_cost_per_1k),
    outputCostPer1k: Number(data.output_cost_per_1k),
    currency: data.currency,
  };
}

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

  const inputCost = (inputTokens / 1000) * params.price.inputCostPer1k;
  const outputCost = (outputTokens / 1000) * params.price.outputCostPer1k;
  return Number((inputCost + outputCost).toFixed(6));
}

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
    const provider = resolveProvider(usage.provider);
    const price = await fetchModelPrice({
      client,
      provider,
      model: usage.model,
    });
    const estimatedCostUsd = calculateEstimatedCostUsd({
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      price,
    });

    const insert: AgentLlmUsageInsert = {
      user_id: userId,
      task_id: params.taskId ?? context?.taskId ?? null,
      session_id: params.sessionId ?? context?.sessionId ?? null,
      task_type: params.taskType ?? context?.taskType ?? null,
      node_key: params.nodeKey ?? context?.nodeKey ?? null,
      agent_type: params.agentType,
      provider: provider ?? null,
      model: usage.model ?? null,
      input_tokens: usage.inputTokens ?? null,
      output_tokens: usage.outputTokens ?? null,
      total_tokens: usage.totalTokens ?? null,
      estimated_cost_usd: estimatedCostUsd,
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
