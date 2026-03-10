import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import * as db from "@/lib/supabase/db";
import * as vaultRepo from "@/lib/vault/repository";
import { chunkAndEmbedDocument } from "@/lib/vault/chunker";
import { triageAtomsToActions } from "@/lib/vault/vault-triage-agent";

function getClient(): SupabaseClient<Database> {
  return createAdminClient();
}

interface ActivityAtom {
  id: string;
  atom_type: string;
  provider: string;
  title: string | null;
  content: string;
  occurred_at: string;
}

export interface VaultFromEventsResult {
  documentsCreated: number;
  documentsUpdated: number;
  actionsProcessed: number;
}

async function fetchRecentAtoms(
  client: SupabaseClient<Database>,
  userId: string,
  options?: {
    sinceAt?: string | null;
    atomIds?: string[];
    externalIds?: string[];
  },
): Promise<ActivityAtom[]> {
  const syncedAt =
    options?.sinceAt ??
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const filters: Record<string, unknown> = { user_id: userId };
  if (options?.atomIds?.length) {
    filters.id = options.atomIds;
  } else if (options?.externalIds?.length) {
    filters.external_id = options.externalIds;
  }

  const { data, error } = await db.selectMany(
    client,
    "activity_atoms",
    filters as Parameters<typeof db.selectMany>[2],
    {
      columns: "id, atom_type, provider, title, content, occurred_at",
      rangeFilters:
        options?.atomIds?.length || options?.externalIds?.length
          ? undefined
          : { synced_at: { gte: syncedAt } },
      order: { column: "synced_at", ascending: false },
      limit: 50,
    },
  );
  if (error) throw new Error(`Failed to fetch atoms: ${error.message}`);
  return (data ?? []) as ActivityAtom[];
}

export async function runVaultFromEventsAgent(
  userId: string,
  options?: {
    sinceAt?: string | null;
    atomIds?: string[];
    externalIds?: string[];
    preferredModel?: string;
  },
): Promise<VaultFromEventsResult> {
  const client = getClient();
  const atoms = await fetchRecentAtoms(client, userId, options);
  if (atoms.length === 0) {
    return { documentsCreated: 0, documentsUpdated: 0, actionsProcessed: 0 };
  }

  const { actions } = await triageAtomsToActions(atoms, {
    preferredModel: options?.preferredModel,
  });

  let documentsCreated = 0;

  for (const action of actions) {
    if (action.action !== "create_document") continue;

    const { data: doc } = await vaultRepo.createDocument(client, {
      tenant_id: userId,
      title: action.title,
      collection_id: action.collection_id ?? null,
      created_by: null,
    });

    if (!doc) continue;

    documentsCreated++;

    await vaultRepo.addVaultChange(client, {
      document_id: doc.id,
      actor_type: "agent",
      actor_id: null,
      action: "create_from_integration",
      patch: {
        content_md: action.content_md,
        source_atom_ids: action.source_atom_ids ?? [],
      },
      summary: `Created from integration events`,
    });

    if (action.content_md) {
      try {
        await chunkAndEmbedDocument(client, doc.id, action.content_md);
      } catch (e) {
        console.error("[vault-from-events] Chunking failed:", e);
      }
    }
  }

  return {
    documentsCreated,
    documentsUpdated: 0,
    actionsProcessed: actions.length,
  };
}
