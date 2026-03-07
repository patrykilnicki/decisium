import { createAdminClient } from "@/lib/supabase/admin";

export interface TaskSearchResult {
  id: string;
  content: string;
  similarity: number;
  status: string;
  priority: string;
  due_at: string | null;
  updated_at: string | null;
}

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function taskScore(
  queryTokens: string[],
  text: string,
  updatedAt?: string | null,
): number {
  const targetTokens = new Set(normalize(text));
  if (targetTokens.size === 0) return 0;
  const overlap = queryTokens.filter((token) => targetTokens.has(token)).length;
  const lexicalScore = overlap / Math.max(queryTokens.length, 1);
  const updatedAtMs = updatedAt ? new Date(updatedAt).getTime() : 0;
  const ageDays =
    updatedAtMs > 0 ? Math.max(0, (Date.now() - updatedAtMs) / 86400000) : 365;
  const recencyBoost = Math.max(0, 1 - ageDays / 30) * 0.2;
  return lexicalScore + recencyBoost;
}

export async function searchTaskItems(params: {
  userId: string;
  query: string;
  limit?: number;
}): Promise<TaskSearchResult[]> {
  const { userId, query, limit = 20 } = params;
  const supabase = createAdminClient();
  const queryTokens = normalize(query);
  const ilike = `%${query.replace(/\s+/g, "%")}%`;

  const { data, error } = await supabase
    .from("todo_items")
    .select("id,title,summary,status,priority,due_at,updated_at")
    .eq("user_id", userId)
    .or(
      `title.ilike.${ilike},summary.ilike.${ilike},suggested_next_action.ilike.${ilike}`,
    )
    .limit(Math.max(limit * 3, 30));

  if (error) {
    console.error("[task-retriever] Failed task search:", error);
    return [];
  }

  return (data ?? [])
    .map((row) => {
      const content = [row.title, row.summary].filter(Boolean).join(". ");
      return {
        id: row.id,
        content,
        similarity: taskScore(queryTokens, content, row.updated_at),
        status: row.status,
        priority: row.priority,
        due_at: row.due_at,
        updated_at: row.updated_at,
      };
    })
    .filter((row) => row.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
