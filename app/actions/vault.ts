"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/db";
import * as vaultRepo from "@/lib/vault/repository";

export async function listDocuments(collectionId?: string) {
  const supabase = await createClient();
  const { user, error: authError } = await getAuthUser(supabase);
  if (authError || !user) {
    return { data: [], error: authError ?? new Error("Unauthorized") };
  }
  return vaultRepo.listDocuments(supabase, user.id, {
    collectionId: collectionId ?? undefined,
  });
}

export async function getDocument(documentId: string) {
  const supabase = await createClient();
  const { user, error: authError } = await getAuthUser(supabase);
  if (authError || !user) {
    return { data: null, error: authError ?? new Error("Unauthorized") };
  }
  const { data, error } = await vaultRepo.getDocument(
    supabase,
    documentId,
    user.id,
  );
  if (error || !data)
    return { data: null, error: error ?? new Error("Not found") };

  let ydocBase64: string | null = null;
  const raw = data.ydoc_state as unknown;
  if (raw) {
    if (raw instanceof Uint8Array) {
      ydocBase64 = Buffer.from(raw).toString("base64");
    } else if (typeof raw === "string") {
      ydocBase64 = Buffer.from(raw, "hex").toString("base64");
    } else if (ArrayBuffer.isView(raw) || raw instanceof ArrayBuffer) {
      ydocBase64 = Buffer.from(raw as ArrayBuffer).toString("base64");
    }
  }

  const contentMarkdown = (data as { content_markdown?: string | null })
    .content_markdown;

  return {
    data: {
      id: data.id,
      title: data.title,
      collection_id: data.collection_id,
      ydoc_state: ydocBase64,
      content_markdown: contentMarkdown ?? null,
      created_at: data.created_at,
      updated_at: data.updated_at,
    },
    error: null,
  };
}

export async function createDocument(payload: {
  title: string;
  collectionId?: string | null;
}) {
  const supabase = await createClient();
  const { user, error: authError } = await getAuthUser(supabase);
  if (authError || !user) {
    return { data: null, error: authError ?? new Error("Unauthorized") };
  }
  return vaultRepo.createDocument(supabase, {
    tenant_id: user.id,
    title: payload.title,
    collection_id: payload.collectionId ?? null,
    created_by: user.id,
  });
}

export async function updateDocument(
  documentId: string,
  payload: {
    title?: string;
    collectionId?: string | null;
    ydocState?: ArrayBuffer | null;
  },
) {
  const supabase = await createClient();
  const { user, error: authError } = await getAuthUser(supabase);
  if (authError || !user) {
    return { data: null, error: authError ?? new Error("Unauthorized") };
  }
  return vaultRepo.updateDocument(supabase, documentId, user.id, {
    title: payload.title,
    collection_id: payload.collectionId ?? null,
    ydoc_state: payload.ydocState ?? undefined,
  });
}

export async function deleteDocument(documentId: string) {
  const supabase = await createClient();
  const { user, error: authError } = await getAuthUser(supabase);
  if (authError || !user) {
    return { error: authError ?? new Error("Unauthorized") };
  }
  return vaultRepo.deleteDocument(supabase, documentId, user.id);
}

export async function listCollections() {
  const supabase = await createClient();
  const { user, error: authError } = await getAuthUser(supabase);
  if (authError || !user) {
    return { data: [], error: authError ?? new Error("Unauthorized") };
  }
  return vaultRepo.listCollections(supabase, user.id);
}

export async function createCollection(name: string) {
  const supabase = await createClient();
  const { user, error: authError } = await getAuthUser(supabase);
  if (authError || !user) {
    return { data: null, error: authError ?? new Error("Unauthorized") };
  }
  return vaultRepo.createCollection(supabase, {
    tenant_id: user.id,
    name,
  });
}
