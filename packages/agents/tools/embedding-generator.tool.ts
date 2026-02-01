import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { generateEmbedding } from "../lib/embeddings";

export const embeddingGeneratorTool = new DynamicStructuredTool({
  name: "embedding_generator",
  description: "Generate and store embeddings for content",
  schema: z.object({
    content: z.string().describe("The content to generate an embedding for"),
  }),
  func: async ({ content }) => {
    const result = await generateEmbedding(content);
    return JSON.stringify({
      embedding: result.embedding,
    });
  },
});
