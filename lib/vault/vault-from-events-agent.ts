import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import * as db from "@/lib/supabase/db";
import { createLLM } from "@/packages/agents/lib/llm";
import * as vaultRepo from "@/lib/vault/repository";
import { chunkAndEmbedDocument } from "@/lib/vault/chunker";
import {
  VaultActionSchema,
  type VaultAction,
} from "@/packages/agents/schemas/vault-action.schema";

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
  sinceAt?: string | null,
): Promise<ActivityAtom[]> {
  const syncedAt =
    sinceAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db.selectMany(
    client,
    "activity_atoms",
    { user_id: userId },
    {
      columns: "id, atom_type, provider, title, content, occurred_at",
      rangeFilters: { synced_at: { gte: syncedAt } },
      order: { column: "synced_at", ascending: false },
      limit: 50,
    },
  );
  if (error) throw new Error(`Failed to fetch atoms: ${error.message}`);
  return (data ?? []) as ActivityAtom[];
}

const SYSTEM_PROMPT = `You analyze integration events (calendar meetings, notes, emails) and decide which should be added to the user's Vault (personal knowledge base).

For each relevant event, output a create_document action with:
- title: concise document title (e.g. "Meeting notes: Project Kickoff")
- content_md: markdown content summarizing or capturing the event
- source_atom_ids: array of activity_atom ids that contributed

Only create documents for substantial events (meetings with title, important notes). Skip routine or low-value events.

Output valid JSON array of actions.`;

export async function runVaultFromEventsAgent(
  userId: string,
  options?: { sinceAt?: string | null },
): Promise<VaultFromEventsResult> {
  const client = getClient();
  const atoms = await fetchRecentAtoms(client, userId, options?.sinceAt);
  if (atoms.length === 0) {
    return { documentsCreated: 0, documentsUpdated: 0, actionsProcessed: 0 };
  }

  const atomsContext = atoms
    .map(
      (a) =>
        `[${a.id}] ${a.atom_type} (${a.provider}): ${a.title ?? "untitled"} - ${a.content.slice(0, 200)}...`,
    )
    .join("\n");

  const llm = createLLM({ model: "gpt-4o-mini" });
  const response = await llm.invoke([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Recent integration events:\n\n${atomsContext}\n\nWhich should become Vault documents? Output JSON array of create_document actions.`,
    },
  ]);

  const content = typeof response.content === "string" ? response.content : "";
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return { documentsCreated: 0, documentsUpdated: 0, actionsProcessed: 0 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { documentsCreated: 0, documentsUpdated: 0, actionsProcessed: 0 };
  }

  const actions = Array.isArray(parsed)
    ? parsed.filter(
        (a): a is VaultAction => VaultActionSchema.safeParse(a).success,
      )
    : [];

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
