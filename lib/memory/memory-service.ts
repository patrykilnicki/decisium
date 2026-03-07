import { createHash } from "crypto";
import type { Json } from "@/types/supabase";
import type { EmbeddingInsert } from "@/types/database";
import { createAdminClient } from "@/lib/supabase/admin";
import * as db from "@/lib/supabase/db";
import { generateEmbedding } from "@/lib/embeddings/generate";

export type MemoryType =
  | "semantic"
  | "episodic"
  | "procedural"
  | "conversation"
  | "task";

export type MemorySource =
  | "daily_event"
  | "summary"
  | "calendar"
  | "gmail"
  | "task"
  | "vault"
  | "insight"
  | "agent";

export interface StoreMemoryParams {
  userId: string;
  content: string;
  memoryType: MemoryType;
  source: MemorySource;
  sourceId?: string;
  importance?: number;
  ttl?: string | null;
  metadata?: Record<string, unknown>;
}

function clampImportance(value: number | undefined): number {
  if (value == null || Number.isNaN(value)) return 0.5;
  return Math.max(0.1, Math.min(2.0, value));
}

function toLegacyType(memoryType: MemoryType, source: MemorySource): string {
  if (memoryType === "conversation") return "ask_message";
  if (source === "daily_event") return "daily_event";
  if (source === "summary") return "daily_summary";
  if (source === "insight") return "insight_source";
  if (source === "task") return "task_item";
  if (source === "calendar" || source === "gmail") return "activity_atom";
  return "memory";
}

function intervalFromTtl(ttl: string | null | undefined): string | null {
  if (!ttl) return null;
  const normalized = ttl.trim().toLowerCase();
  if (!normalized) return null;
  return normalized;
}

function expiresAtFromTtl(ttl: string | null | undefined): string | null {
  if (!ttl) return null;
  const normalized = ttl.trim().toLowerCase();
  const now = new Date();
  const match = normalized.match(/^(\d+)\s*(day|days|hour|hours)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (unit.startsWith("day")) now.setUTCDate(now.getUTCDate() + amount);
  if (unit.startsWith("hour")) now.setUTCHours(now.getUTCHours() + amount);
  return now.toISOString();
}

function createContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function storeMemory(params: StoreMemoryParams): Promise<string> {
  const content = params.content.trim();
  if (!content) throw new Error("storeMemory requires non-empty content");

  const { embedding } = await generateEmbedding(content);
  const embeddingString = `[${embedding.join(",")}]`;
  const importance = clampImportance(params.importance);
  const ttl = intervalFromTtl(params.ttl);
  const expiresAt = expiresAtFromTtl(params.ttl);
  const contentHash = createContentHash(content);

  const metadata: Record<string, unknown> = {
    type: toLegacyType(params.memoryType, params.source),
    source_id: params.sourceId,
    source: params.source,
    memory_type: params.memoryType,
    importance,
    ...(params.metadata ?? {}),
  };

  const insertData: EmbeddingInsert & {
    memory_type?: MemoryType;
    source?: MemorySource;
    source_id?: string | null;
    importance?: number;
    ttl?: string | null;
    expires_at?: string | null;
    content_hash?: string;
  } = {
    user_id: params.userId,
    content,
    embedding: embeddingString,
    metadata: metadata as Json,
    memory_type: params.memoryType,
    source: params.source,
    source_id: params.sourceId ?? null,
    importance,
    ttl,
    expires_at: expiresAt,
    content_hash: contentHash,
  };

  const supabase = createAdminClient();
  const { data, error } = await db.insertOne(
    supabase,
    "embeddings",
    insertData as never,
  );
  if (error || !data)
    throw new Error(`Failed to store memory embedding: ${error?.message}`);

  return (data as { id: string }).id;
}
