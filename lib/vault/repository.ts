import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import * as db from "@/lib/supabase/db";

export interface VaultDocumentRow {
  id: string;
  tenant_id: string;
  collection_id: string | null;
  title: string;
  ydoc_state: string | null;
  content_markdown?: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface VaultCollectionRow {
  id: string;
  tenant_id: string;
  name: string;
  created_at: string | null;
  updated_at: string | null;
}

export async function listDocuments(
  client: SupabaseClient<Database>,
  tenantId: string,
  options?: { collectionId?: string; limit?: number },
): Promise<{ data: VaultDocumentRow[]; error: Error | null }> {
  const filters: Record<string, string> = { tenant_id: tenantId };
  if (options?.collectionId) {
    filters.collection_id = options.collectionId;
  }
  return db.selectMany(client, "vault_documents", filters, {
    order: { column: "updated_at", ascending: false },
    limit: options?.limit ?? 50,
  });
}

export async function getDocument(
  client: SupabaseClient<Database>,
  documentId: string,
  tenantId: string,
): Promise<{ data: VaultDocumentRow | null; error: Error | null }> {
  return db.selectOne(client, "vault_documents", {
    id: documentId,
    tenant_id: tenantId,
  });
}

export async function createDocument(
  client: SupabaseClient<Database>,
  payload: {
    tenant_id: string;
    title: string;
    collection_id?: string | null;
    created_by?: string | null;
    ydoc_state?: Uint8Array | ArrayBuffer | null;
    content_markdown?: string | null;
  },
): Promise<{ data: VaultDocumentRow | null; error: Error | null }> {
  const ydoc =
    payload.ydoc_state instanceof Uint8Array
      ? payload.ydoc_state
      : payload.ydoc_state
        ? new Uint8Array(payload.ydoc_state)
        : null;
  const insertPayload = {
    tenant_id: payload.tenant_id,
    title: payload.title,
    collection_id: payload.collection_id ?? null,
    created_by: payload.created_by ?? null,
    ydoc_state: ydoc,
    content_markdown: payload.content_markdown ?? null,
  };
  return db.insertOne(client, "vault_documents", insertPayload as never);
}

export async function updateDocument(
  client: SupabaseClient<Database>,
  documentId: string,
  tenantId: string,
  payload: {
    title?: string;
    collection_id?: string | null;
    ydoc_state?: Uint8Array | ArrayBuffer | null;
    content_markdown?: string | null;
  },
): Promise<{ data: VaultDocumentRow | null; error: Error | null }> {
  const updatePayload: Record<string, unknown> = {};
  if (payload.title !== undefined) updatePayload.title = payload.title;
  if (payload.collection_id !== undefined)
    updatePayload.collection_id = payload.collection_id;
  if (payload.ydoc_state !== undefined) {
    const ydoc =
      payload.ydoc_state instanceof Uint8Array
        ? payload.ydoc_state
        : payload.ydoc_state
          ? new Uint8Array(payload.ydoc_state)
          : null;
    updatePayload.ydoc_state = ydoc;
  }
  if (payload.content_markdown !== undefined)
    updatePayload.content_markdown = payload.content_markdown;
  const result = await db.update(
    client,
    "vault_documents",
    { id: documentId, tenant_id: tenantId },
    updatePayload as never,
    { returning: "single" },
  );
  return { data: result.data as VaultDocumentRow | null, error: result.error };
}

export async function deleteDocument(
  client: SupabaseClient<Database>,
  documentId: string,
  tenantId: string,
): Promise<{ error: Error | null }> {
  const { error } = await db.remove(client, "vault_documents", {
    id: documentId,
    tenant_id: tenantId,
  });
  return { error };
}

export async function listCollections(
  client: SupabaseClient<Database>,
  tenantId: string,
): Promise<{ data: VaultCollectionRow[]; error: Error | null }> {
  return db.selectMany(
    client,
    "vault_collections",
    { tenant_id: tenantId },
    {
      order: { column: "name", ascending: true },
      limit: 100,
    },
  );
}

export async function createCollection(
  client: SupabaseClient<Database>,
  payload: { tenant_id: string; name: string },
): Promise<{ data: VaultCollectionRow | null; error: Error | null }> {
  return db.insertOne(client, "vault_collections", payload as never);
}

export async function addVaultChange(
  client: SupabaseClient<Database>,
  payload: {
    document_id: string;
    actor_type: "user" | "agent" | "system";
    actor_id?: string | null;
    action?: string | null;
    patch?: unknown;
    summary?: string | null;
  },
): Promise<{ error: Error | null }> {
  const { error } = await db.insertOne(
    client,
    "vault_changes",
    payload as never,
  );
  return { error };
}
