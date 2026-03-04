import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { searchVaultChunks } from "@/lib/vault/vault-retriever";

export const vaultSearchTool = new DynamicStructuredTool({
  name: "vault_search",
  description:
    "Search the user's Collections documents semantically. Use when the user asks about notes, documents, or knowledge stored in their Collections. Pass userId and query.",
  schema: z.object({
    userId: z
      .string()
      .describe("The user ID to search Collections documents for"),
    query: z
      .string()
      .describe("The search query to find relevant Collections content"),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe("Maximum number of Collections chunks to return"),
  }),
  func: async ({ userId, query, maxResults }) => {
    try {
      const results = await searchVaultChunks(query, userId, {
        threshold: 0.4,
        limit: maxResults,
      });

      return JSON.stringify({
        results: results.map((r) => ({
          content: r.content,
          document_id: r.document_id,
          heading_path: r.heading_path,
          similarity: r.similarity,
        })),
        total_found: results.length,
      });
    } catch (error) {
      console.error("[vault_search] Error:", error);
      return JSON.stringify({
        results: [],
        total_found: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
});
