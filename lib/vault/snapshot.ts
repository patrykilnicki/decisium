import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import * as db from "@/lib/supabase/db";

const CHANGES_BEFORE_SNAPSHOT = 20;

export async function maybeCreateSnapshot(
  client: SupabaseClient<Database>,
  documentId: string,
): Promise<{ created: boolean; version?: number }> {
  const { data: lastSnapshot } = await db.selectMany(
    client,
    "vault_snapshots",
    { document_id: documentId },
    { order: { column: "version", ascending: false }, limit: 1 },
  );

  const lastVersion = lastSnapshot?.length
    ? (lastSnapshot[0] as { version: number }).version
    : 0;

  const { data: changes } = await db.selectMany(
    client,
    "vault_changes",
    { document_id: documentId },
    { limit: 1000 },
  );

  const changesSinceLastSnapshot = lastSnapshot?.length
    ? changes.filter(
        (c) =>
          new Date((c as { created_at: string }).created_at) >
          new Date((lastSnapshot[0] as { created_at: string }).created_at),
      ).length
    : changes.length;

  if (changesSinceLastSnapshot < CHANGES_BEFORE_SNAPSHOT) {
    return { created: false };
  }

  const { data: doc } = await db.selectOne(client, "vault_documents", {
    id: documentId,
  });
  if (!doc) return { created: false };

  const contentMarkdown = (doc as { content_markdown?: string | null })
    .content_markdown;
  const version = lastVersion + 1;
  const { error } = await db.insertOne(client, "vault_snapshots", {
    document_id: documentId,
    version,
    content_json: null,
    content_md: contentMarkdown ?? null,
  } as never);

  if (error) {
    console.error("[vault/snapshot] Failed to create snapshot:", error);
    return { created: false };
  }

  return { created: true, version };
}
