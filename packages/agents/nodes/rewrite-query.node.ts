import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createLLM } from "../lib/llm";
import { REWRITE_QUERY_PROMPT } from "../prompts";

/**
 * Query rewrite prompt template (loaded from prompts/rewrite-query.md)
 */
const REWRITE_PROMPT = ChatPromptTemplate.fromTemplate(REWRITE_QUERY_PROMPT);

export interface RewriteQueryConfig {
  llmProvider?: "openai" | "anthropic" | "openrouter";
  model?: string;
  temperature?: number;
}

/**
 * Create a query rewriter
 */
export function createQueryRewriter(config?: RewriteQueryConfig) {
  const provider =
    config?.llmProvider ||
    (process.env.LLM_PROVIDER as "openai" | "anthropic" | "openrouter") ||
    "anthropic";

  const llm = createLLM({
    provider,
    model: config?.model,
    temperature: config?.temperature ?? 0.5, // Moderate temperature for creative reformulation
  });

  return {
    llm,
    prompt: REWRITE_PROMPT,
  };
}

/**
 * Rewrite a query to improve retrieval results
 */
export async function rewriteQuery(
  originalQuery: string,
  config?: RewriteQueryConfig,
): Promise<string> {
  const rewriter = createQueryRewriter(config);

  const formattedPrompt = await REWRITE_PROMPT.format({
    question: originalQuery,
  });

  const response = await rewriter.llm.invoke(formattedPrompt);

  // Extract content from response
  const rewrittenQuery =
    typeof response.content === "string"
      ? response.content.trim()
      : Array.isArray(response.content)
        ? response.content
            .map((c: unknown) =>
              typeof c === "string" ? c : ((c as { text?: string }).text ?? ""),
            )
            .join("")
            .trim()
        : originalQuery;

  return rewrittenQuery || originalQuery;
}

/**
 * Node function for LangGraph integration
 * Accepts state and returns partial state update with rewritten query
 */
export async function rewriteQueryNode<
  TState extends {
    userMessage?: string;
    originalQuery?: string;
    rewriteCount?: number;
  },
>(
  state: TState,
  config?: RewriteQueryConfig,
): Promise<{
  rewrittenQuery: string;
  rewriteCount: number;
  originalQuery: string;
}> {
  const originalQuery = state.originalQuery || state.userMessage || "";
  const currentRewriteCount = state.rewriteCount || 0;

  if (!originalQuery) {
    return {
      rewrittenQuery: "",
      rewriteCount: currentRewriteCount,
      originalQuery: "",
    };
  }

  try {
    const rewrittenQuery = await rewriteQuery(originalQuery, config);

    console.log(`[rewriteQueryNode] Rewrite #${currentRewriteCount + 1}:`);
    console.log(`  Original: "${originalQuery}"`);
    console.log(`  Rewritten: "${rewrittenQuery}"`);

    return {
      rewrittenQuery,
      rewriteCount: currentRewriteCount + 1,
      originalQuery,
    };
  } catch (error) {
    console.error("[rewriteQueryNode] Error during query rewrite:", error);
    // On error, return original query
    return {
      rewrittenQuery: originalQuery,
      rewriteCount: currentRewriteCount + 1,
      originalQuery,
    };
  }
}

/**
 * Check if we should continue rewriting or give up
 */
export function shouldContinueRewriting(state: {
  rewriteCount?: number;
  maxRewrites?: number;
}): boolean {
  const maxRewrites = state.maxRewrites || 2;
  const currentRewrites = state.rewriteCount || 0;

  return currentRewrites < maxRewrites;
}
