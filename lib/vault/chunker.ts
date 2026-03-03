import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { generateEmbedding } from "@/packages/agents/lib/embeddings";
import * as db from "@/lib/supabase/db";

const CHUNK_TOKEN_TARGET = 400;
const TOKENS_PER_CHAR_ESTIMATE = 0.25;

interface ChunkInput {
  content: string;
  headingPath?: string;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHAR_ESTIMATE);
}

function chunkBySize(text: string, maxTokens: number): string[] {
  const chunks: string[] = [];
  const maxChars = Math.floor(maxTokens / TOKENS_PER_CHAR_ESTIMATE);
  let remaining = text.trim();
  if (!remaining) return [];

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }
    let cut = remaining.slice(0, maxChars);
    const lastNewline = cut.lastIndexOf("\n");
    const lastPeriod = cut.lastIndexOf(". ");
    const splitAt =
      lastNewline > maxChars * 0.5
        ? lastNewline + 1
        : lastPeriod > maxChars * 0.5
          ? lastPeriod + 2
          : maxChars;
    cut = remaining.slice(0, splitAt);
    remaining = remaining.slice(splitAt).trim();
    chunks.push(cut);
  }
  return chunks;
}

function splitByHeadings(text: string): ChunkInput[] {
  const lines = text.split("\n");
  const result: ChunkInput[] = [];
  let currentHeading = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (currentContent.length > 0) {
        const content = currentContent.join("\n").trim();
        if (content) {
          result.push({
            content,
            headingPath: currentHeading || undefined,
          });
        }
      }
      currentHeading = headingMatch[2].trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentContent.length > 0) {
    const content = currentContent.join("\n").trim();
    if (content) {
      result.push({
        content,
        headingPath: currentHeading || undefined,
      });
    }
  }

  if (result.length === 0 && text.trim()) {
    return [{ content: text.trim() }];
  }
  return result;
}

function chunkContent(content: string): ChunkInput[] {
  const byHeading = splitByHeadings(content);
  const result: ChunkInput[] = [];
  for (const section of byHeading) {
    const tokens = estimateTokens(section.content);
    if (tokens <= CHUNK_TOKEN_TARGET) {
      result.push(section);
    } else {
      const subChunks = chunkBySize(section.content, CHUNK_TOKEN_TARGET);
      for (let i = 0; i < subChunks.length; i++) {
        result.push({
          content: subChunks[i],
          headingPath: section.headingPath,
        });
      }
    }
  }
  return result;
}

export async function chunkAndEmbedDocument(
  client: SupabaseClient<Database>,
  documentId: string,
  content: string,
): Promise<{ chunksCreated: number }> {
  const chunks = chunkContent(content);
  if (chunks.length === 0) return { chunksCreated: 0 };

  await db.remove(client, "vault_chunks", { document_id: documentId });

  let chunksCreated = 0;
  for (let i = 0; i < chunks.length; i++) {
    const { content: chunkContent, headingPath } = chunks[i];
    const { embedding } = await generateEmbedding(chunkContent);
    const embeddingString = `[${embedding.join(",")}]`;
    const tokenCount = estimateTokens(chunkContent);

    const { error } = await db.insertOne(client, "vault_chunks", {
      document_id: documentId,
      chunk_index: i,
      heading_path: headingPath ?? null,
      content: chunkContent,
      embedding: embeddingString,
      token_count: tokenCount,
    } as never);

    if (!error) chunksCreated++;
  }

  return { chunksCreated };
}
