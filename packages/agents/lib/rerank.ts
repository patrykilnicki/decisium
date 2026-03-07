interface RerankInputItem {
  id: string;
  content: string;
  score: number;
}

export interface RerankResultItem {
  id: string;
  score: number;
}

const DEFAULT_BGE_MODEL =
  process.env.RERANKER_MODEL || "BAAI/bge-reranker-v2-m3";
const DEFAULT_BGE_URL =
  process.env.BGE_RERANKER_URL ||
  "https://api-inference.huggingface.co/models/BAAI/bge-reranker-v2-m3";

function localRerank(
  query: string,
  items: RerankInputItem[],
): RerankResultItem[] {
  const q = query.toLowerCase();
  return items
    .map((item) => {
      const lexical = item.content.toLowerCase().includes(q) ? 0.25 : 0;
      return { id: item.id, score: item.score + lexical };
    })
    .sort((a, b) => b.score - a.score);
}

async function remoteBgeRerank(
  query: string,
  items: RerankInputItem[],
): Promise<RerankResultItem[] | null> {
  const apiKey = process.env.BGE_RERANKER_API_KEY || process.env.HF_API_KEY;
  if (!apiKey) return null;

  const response = await fetch(DEFAULT_BGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_BGE_MODEL,
      query,
      documents: items.map((item) => item.content),
    }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as unknown;

  if (Array.isArray(payload)) {
    // HF endpoint may return scores directly as array of numbers.
    return payload
      .map((score, index) => ({
        id: items[index]?.id,
        score: typeof score === "number" ? score : (items[index]?.score ?? 0),
      }))
      .filter((row): row is RerankResultItem => typeof row.id === "string")
      .sort((a, b) => b.score - a.score);
  }

  if (
    payload &&
    typeof payload === "object" &&
    "results" in (payload as Record<string, unknown>) &&
    Array.isArray((payload as { results: unknown[] }).results)
  ) {
    const results = (
      payload as { results: Array<{ index: number; relevance_score: number }> }
    ).results;
    return results
      .map((row) => ({
        id: items[row.index]?.id,
        score: row.relevance_score,
      }))
      .filter((row): row is RerankResultItem => typeof row.id === "string")
      .sort((a, b) => b.score - a.score);
  }

  return null;
}

export async function rerankCandidates(params: {
  query: string;
  items: RerankInputItem[];
}): Promise<RerankResultItem[]> {
  const { query, items } = params;
  if (items.length === 0) return [];

  const provider = (process.env.RERANKER_PROVIDER || "bge").toLowerCase();
  if (provider === "bge") {
    try {
      const remote = await remoteBgeRerank(query, items);
      if (remote && remote.length > 0) return remote;
    } catch (error) {
      console.error("[rerank] Remote BGE rerank failed:", error);
    }
  }

  return localRerank(query, items);
}
