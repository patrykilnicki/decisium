import { storeMemory } from "@/lib/memory/memory-service";

export interface StoreEmbeddingParams {
  userId: string;
  content: string;
  metadata: {
    type:
      | "daily_event"
      | "daily_summary"
      | "weekly_summary"
      | "monthly_summary";
    source_id: string;
    date: string;
  };
}

export async function storeEmbedding(
  params: StoreEmbeddingParams,
): Promise<string> {
  const source =
    params.metadata.type === "daily_event"
      ? "daily_event"
      : params.metadata.type === "daily_summary" ||
          params.metadata.type === "weekly_summary" ||
          params.metadata.type === "monthly_summary"
        ? "summary"
        : "agent";
  const memoryType =
    params.metadata.type === "daily_event" ? "episodic" : "semantic";
  return storeMemory({
    userId: params.userId,
    content: params.content,
    memoryType,
    source,
    sourceId: params.metadata.source_id,
    metadata: {
      ...params.metadata,
      date: params.metadata.date,
    },
  });
}
