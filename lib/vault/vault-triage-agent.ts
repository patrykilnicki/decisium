/**
 * Vault Triage Agent — LangGraph map-reduce for atom → create_document actions.
 *
 * Splits atoms into batches, processes each with the LLM in parallel via Send API,
 * then aggregates and dedupes actions. Avoids context truncation on large atom sets.
 */
import { Annotation, Send, StateGraph, START, END } from "@langchain/langgraph";
import { createLLM } from "@/packages/agents/lib/llm";
import {
  VaultActionSchema,
  type VaultAction,
} from "@/packages/agents/schemas/vault-action.schema";

const BATCH_SIZE = 10;

interface ActivityAtom {
  id: string;
  atom_type: string;
  provider: string;
  title: string | null;
  content: string;
  occurred_at: string;
}

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

const VaultTriageState = Annotation.Root({
  atoms: Annotation<ActivityAtom[]>(),
  batchedActions: Annotation<VaultAction[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  errors: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  finalActions: Annotation<VaultAction[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
});

const SYSTEM_PROMPT = `You analyze integration events (calendar meetings, notes, emails) and decide which should be added to the user's Collections (personal knowledge base).

For each relevant event, output a create_document action with:
- title: concise document title (e.g. "Meeting notes: Project Kickoff")
- content_md: markdown content summarizing or capturing the event
- source_atom_ids: array of activity_atom ids that contributed

Only create documents for substantial events (meetings with title, important notes). Skip routine or low-value events.

Output valid JSON array of actions.`;

function atomsToContext(atoms: ActivityAtom[]): string {
  return atoms
    .map(
      (a) =>
        `[${a.id}] ${a.atom_type} (${a.provider}): ${a.title ?? "untitled"} - ${a.content.slice(0, 200)}...`,
    )
    .join("\n");
}

function extractJsonArrayFromResponse(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const match = raw.trim().match(/\[[\s\S]*\]/);
  return match ? match[0] : null;
}

// ═══════════════════════════════════════════════════════════════
// NODES
// ═══════════════════════════════════════════════════════════════

function fanOutBatches(
  state: typeof VaultTriageState.State,
): Send[] | "finalize" {
  const { atoms } = state;
  if (!atoms || atoms.length === 0) return "finalize";

  const sends: Send[] = [];
  for (let i = 0; i < atoms.length; i += BATCH_SIZE) {
    const batch = atoms.slice(i, i + BATCH_SIZE);
    sends.push(new Send("extractBatch", { batchAtoms: batch }));
  }
  return sends;
}

async function extractBatch(state: {
  batchAtoms: ActivityAtom[];
}): Promise<Partial<typeof VaultTriageState.State>> {
  const { batchAtoms } = state;
  const context = atomsToContext(batchAtoms);

  const llm = createLLM({ model: "gpt-4o-mini" });
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: `Recent integration events:\n\n${context}\n\nWhich should become Collections documents? Output JSON array of create_document actions.`,
    },
  ];

  try {
    const response = await llm.invoke(messages);
    const rawText =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .map((c) =>
                typeof c === "string"
                  ? c
                  : ((c as { text?: string }).text ?? ""),
              )
              .join("")
          : "";
    const jsonStr = extractJsonArrayFromResponse(rawText);
    if (!jsonStr) {
      return {
        errors: ["LLM returned no JSON array"],
      };
    }
    const parsed = JSON.parse(jsonStr) as unknown;
    if (!Array.isArray(parsed)) {
      return { errors: ["Parsed result is not an array"] };
    }
    const actions = parsed.filter(
      (a): a is VaultAction => VaultActionSchema.safeParse(a).success,
    );
    return { batchedActions: actions };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[vault-triage] Batch failed:", msg);
    return { errors: [msg] };
  }
}

function finalize(state: typeof VaultTriageState.State) {
  const { batchedActions } = state;
  if (!batchedActions?.length) return { finalActions: [] };

  const seenKeys = new Set<string>();
  const deduped: VaultAction[] = [];
  for (const action of batchedActions) {
    if (action.action !== "create_document") continue;
    const ids = action.source_atom_ids ?? [];
    const key = ids.length > 0 ? ids.sort().join(",") : action.title;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(action);
  }
  return { finalActions: deduped };
}

// ═══════════════════════════════════════════════════════════════
// GRAPH & PUBLIC API
// ═══════════════════════════════════════════════════════════════

function buildVaultTriageGraph() {
  return new StateGraph(VaultTriageState)
    .addNode("extractBatch", extractBatch, { ends: ["finalize"] })
    .addNode("finalize", finalize)
    .addConditionalEdges(START, fanOutBatches, {
      finalize: "finalize",
      extractBatch: "extractBatch",
    })
    .addEdge("extractBatch", "finalize")
    .addEdge("finalize", END)
    .compile();
}

export interface VaultTriageResult {
  actions: VaultAction[];
  batchCount: number;
  errors: string[];
}

export async function triageAtomsToActions(
  atoms: ActivityAtom[],
): Promise<VaultTriageResult> {
  if (atoms.length === 0) {
    return { actions: [], batchCount: 0, errors: [] };
  }

  const graph = buildVaultTriageGraph();
  const result = await graph.invoke({ atoms });
  const batchCount = Math.ceil(atoms.length / BATCH_SIZE);

  return {
    actions: result.finalActions ?? [],
    batchCount,
    errors: result.errors ?? [],
  };
}
