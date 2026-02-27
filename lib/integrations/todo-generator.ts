import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase";
import type { ActivityAtom, Integration } from "@/types/database";
import { createLLM } from "@/packages/agents/lib/llm";
import {
  TodoListOutputSchema,
  type GenerateTodoListInput,
  type TodoItem,
  type TodoListOutput,
  type TodoUpdateReason,
} from "@/packages/agents/schemas/todo.schema";

export interface TodoSnapshotRow {
  id: string;
  user_id: string;
  mode: string;
  window_from: string;
  window_to: string;
  payload: Json;
  generated_from_event: string | null;
  created_at: string | null;
}

export interface TodoGenerateOptions {
  generatedFromEvent?: string;
}

function getUpdateReason(params: {
  generatedFromEvent?: string;
  hadSnapshot: boolean;
  hasNewContext?: boolean;
  prunedResolvedItems: number;
}): TodoUpdateReason {
  if (!params.hadSnapshot) return "initial_generation";
  if (params.prunedResolvedItems > 0) return "resolved_items_pruned";
  if (params.generatedFromEvent?.includes("webhook"))
    return "webhook_change_detected";
  if (params.generatedFromEvent?.includes("manual"))
    return "manual_regeneration";
  if (params.hasNewContext) return "new_integration_context";
  return "no_changes_detected";
}

function buildStats(items: TodoItem[]): TodoListOutput["stats"] {
  const byPriority = { low: 0, medium: 0, high: 0, urgent: 0 };
  const byProvider: Record<string, number> = {};
  for (const item of items) {
    byPriority[item.priority] += 1;
    byProvider[item.sourceProvider] =
      (byProvider[item.sourceProvider] ?? 0) + 1;
  }
  return { total: items.length, byPriority, byProvider };
}

function groupByProvider(
  items: TodoItem[],
  integrations: Integration[],
): Record<string, TodoItem[]> {
  const grouped: Record<string, TodoItem[]> = {};
  for (const integration of integrations) {
    grouped[integration.provider] = [];
  }
  for (const item of items) {
    if (!grouped[item.sourceProvider]) grouped[item.sourceProvider] = [];
    grouped[item.sourceProvider].push(item);
  }
  return grouped;
}

const TASK_EXTRACTION_PROMPT = `You are an intelligent task extraction system for a personal productivity app.

You will receive a list of recent integration signals (calendar events, emails, project issues, notes) from the user's connected apps.

Your job is to extract ONLY genuinely actionable tasks — things the user needs to DO or FOLLOW UP on. Each task must be assigned to its correct date.

RULES:
- Calendar events that are just appointments (barber, gym, lunch, dinner, church) are NOT tasks unless they require preparation or follow-up.
- Calendar meetings that need preparation (client call, presentation, review) ARE tasks — the task is the preparation, not the meeting itself.
- Emails that need a reply or action ARE tasks.
- Project issues (Linear, Notion) that are assigned/open ARE tasks.
- Each task MUST have a specific dueAt date (ISO 8601 format). Use the event date for preparation tasks (same day or day before).
- Do NOT create duplicate tasks for the same underlying item.
- Be selective — quality over quantity. Only include items that genuinely need the user's attention.
- Tasks should be concise and actionable (start with a verb when possible).

Current date: {{currentDate}}

Return a JSON array of task objects. Each object must have exactly these fields:
{
  "title": "short actionable title (max 80 chars)",
  "summary": "one sentence explaining what needs to be done",
  "priority": "low" | "medium" | "high" | "urgent",
  "dueAt": "ISO 8601 date string (e.g. 2026-02-27T00:00:00.000Z)",
  "sourceProvider": "the provider slug (google_calendar, gmail, linear, notion, etc)",
  "sourceType": "calendar_event" | "message" | "task" | "note",
  "sourceExternalId": "the external_id of the source atom or empty string",
  "suggestedNextAction": "one sentence describing the concrete next step",
  "tags": ["relevant", "tags"]
}

Return ONLY the JSON array, no markdown, no explanation. If no actionable tasks exist, return [].`;

interface LlmExtractedTask {
  title: string;
  summary: string;
  priority: "low" | "medium" | "high" | "urgent";
  dueAt: string;
  sourceProvider: string;
  sourceType: string;
  sourceExternalId?: string;
  suggestedNextAction: string;
  tags?: string[];
}

function atomsToPromptContext(atoms: ActivityAtom[]): string {
  return atoms
    .map((atom) => {
      const meta = (atom.metadata ?? {}) as Record<string, unknown>;
      const parts = [
        `[${atom.provider}] ${atom.atom_type}: "${atom.title ?? "Untitled"}"`,
        `Date: ${atom.occurred_at}`,
        atom.content ? `Content: ${atom.content.slice(0, 300)}` : "",
        atom.duration_minutes ? `Duration: ${atom.duration_minutes}min` : "",
        Array.isArray(atom.participants) && atom.participants.length > 0
          ? `Participants: ${atom.participants.join(", ")}`
          : "",
        meta.status ? `Status: ${String(meta.status)}` : "",
        `ExternalID: ${atom.external_id}`,
      ];
      return parts.filter(Boolean).join(" | ");
    })
    .join("\n");
}

function llmTaskToTodoItem(
  task: LlmExtractedTask,
  atomMap: Map<string, ActivityAtom>,
): TodoItem {
  const matchedAtom = task.sourceExternalId
    ? atomMap.get(task.sourceExternalId)
    : undefined;

  return {
    id: matchedAtom?.id ?? crypto.randomUUID(),
    title: task.title.slice(0, 120),
    summary: task.summary.slice(0, 500),
    priority: task.priority,
    status: "open",
    dueAt: task.dueAt || null,
    sourceProvider: task.sourceProvider,
    sourceType: task.sourceType,
    sourceRef: {
      integrationId: matchedAtom?.integration_id ?? undefined,
      activityAtomId: matchedAtom?.id,
      externalId: task.sourceExternalId || undefined,
      sourceUrl: matchedAtom?.source_url ?? undefined,
    },
    confidence: 0.8,
    tags: task.tags ?? [task.sourceProvider],
    suggestedNextAction: task.suggestedNextAction,
  };
}

async function extractTasksWithLlm(
  atoms: ActivityAtom[],
  currentDate: string,
): Promise<TodoItem[]> {
  if (atoms.length === 0) return [];

  const llm = createLLM({ temperature: 0.2 });
  const prompt = TASK_EXTRACTION_PROMPT.replace("{{currentDate}}", currentDate);
  const context = atomsToPromptContext(atoms);

  const atomMap = new Map(atoms.map((a) => [a.external_id, a]));

  const response = await llm.invoke([
    { role: "system", content: prompt },
    {
      role: "user",
      content: `Here are the user's recent integration signals:\n\n${context}`,
    },
  ]);

  const text =
    typeof response.content === "string"
      ? response.content
      : Array.isArray(response.content)
        ? response.content
            .map((c) =>
              typeof c === "string" ? c : ((c as { text?: string }).text ?? ""),
            )
            .join("")
        : "";

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]) as LlmExtractedTask[];
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const items: TodoItem[] = [];
    for (const task of parsed) {
      if (!task.title || !task.dueAt) continue;
      const key = `${task.sourceProvider}:${task.title.toLowerCase().trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(llmTaskToTodoItem(task, atomMap));
    }
    return items;
  } catch {
    console.error("[todo-generator] Failed to parse LLM response");
    return [];
  }
}

export class TodoGenerator {
  private supabase: SupabaseClient<Database>;

  constructor(supabase: SupabaseClient<Database>) {
    this.supabase = supabase;
  }

  private createEmptyList(params: {
    userId: string;
    from: Date;
    to: Date;
    updatedBecause: TodoUpdateReason;
  }): TodoListOutput {
    return TodoListOutputSchema.parse({
      listId: crypto.randomUUID(),
      userId: params.userId,
      generatedAt: new Date().toISOString(),
      updatedBecause: params.updatedBecause,
      changeSummary: { generatedItems: 0, prunedResolvedItems: 0 },
      window: { from: params.from.toISOString(), to: params.to.toISOString() },
      items: [],
      groupedByProvider: {},
      stats: {
        total: 0,
        byPriority: { low: 0, medium: 0, high: 0, urgent: 0 },
        byProvider: {},
      },
      version: "1.0",
    });
  }

  async hasAnyGenerationContext(userId: string): Promise<boolean> {
    const [atomsResult, integrationsResult] = await Promise.all([
      this.supabase
        .from("activity_atoms")
        .select("id")
        .eq("user_id", userId)
        .limit(1),
      this.supabase
        .from("integrations")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "active")
        .limit(1),
    ]);
    return (
      (atomsResult.data?.length ?? 0) > 0 ||
      (integrationsResult.data?.length ?? 0) > 0
    );
  }

  private async getLatestSnapshotRow(
    userId: string,
  ): Promise<TodoSnapshotRow | null> {
    const { data, error } = await this.supabase
      .from("todo_snapshots")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return data as TodoSnapshotRow;
  }

  async getLatestSnapshot(userId: string): Promise<TodoListOutput | null> {
    const data = await this.getLatestSnapshotRow(userId);
    if (!data) return null;
    try {
      return TodoListOutputSchema.parse(data.payload);
    } catch {
      return null;
    }
  }

  async hasNewIntegrationContextSince(
    userId: string,
    sinceIso: string,
  ): Promise<boolean> {
    const [atomsResult, integrationsResult] = await Promise.all([
      this.supabase
        .from("activity_atoms")
        .select("id")
        .eq("user_id", userId)
        .or(
          `updated_at.gt.${sinceIso},synced_at.gt.${sinceIso},created_at.gt.${sinceIso}`,
        )
        .limit(1),
      this.supabase
        .from("integrations")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "active")
        .gt("updated_at", sinceIso)
        .limit(1),
    ]);
    return (
      (atomsResult.data?.length ?? 0) > 0 ||
      (integrationsResult.data?.length ?? 0) > 0
    );
  }

  async generateSmart(
    input: GenerateTodoListInput,
    options?: TodoGenerateOptions,
  ): Promise<TodoListOutput> {
    const now = new Date();
    const windowFrom = new Date(
      now.getTime() - input.windowHours * 60 * 60 * 1000,
    );
    const latestRow = await this.getLatestSnapshotRow(input.userId);
    if (!latestRow) {
      const hasContext = await this.hasAnyGenerationContext(input.userId);
      if (!hasContext) {
        return this.createEmptyList({
          userId: input.userId,
          from: windowFrom,
          to: now,
          updatedBecause: "no_changes_detected",
        });
      }
      return this.generate({ ...input, mode: "regenerate" }, options);
    }

    const latestPayload = await this.getLatestSnapshot(input.userId);
    if (!latestPayload) {
      return this.generate({ ...input, mode: "regenerate" }, options);
    }

    const snapshotCreatedAt = latestRow.created_at ?? latestPayload.generatedAt;
    const hasNewContext = await this.hasNewIntegrationContextSince(
      input.userId,
      snapshotCreatedAt,
    );

    if (!hasNewContext) {
      return TodoListOutputSchema.parse({
        ...latestPayload,
        updatedBecause: "no_changes_detected",
      });
    }

    return this.generate({ ...input, mode: "regenerate" }, options);
  }

  async generate(
    input: GenerateTodoListInput,
    options?: TodoGenerateOptions,
  ): Promise<TodoListOutput> {
    const now = new Date();
    const windowFrom = new Date(
      now.getTime() - input.windowHours * 60 * 60 * 1000,
    );
    const hadSnapshot = Boolean(await this.getLatestSnapshotRow(input.userId));

    if (input.mode === "latest") {
      const latest = await this.getLatestSnapshot(input.userId);
      if (latest) return latest;
    }

    const [atoms, integrations] = await Promise.all([
      this.fetchAtoms(input.userId, windowFrom, now),
      this.fetchActiveIntegrations(input.userId),
    ]);

    const currentDate = now.toISOString().split("T")[0];
    const todoItems = await extractTasksWithLlm(atoms, currentDate);
    const capped = todoItems.slice(0, input.maxItems);
    const grouped = groupByProvider(capped, integrations);

    const list: TodoListOutput = {
      listId: crypto.randomUUID(),
      userId: input.userId,
      generatedAt: now.toISOString(),
      updatedBecause: getUpdateReason({
        generatedFromEvent: options?.generatedFromEvent,
        hadSnapshot,
        prunedResolvedItems: Math.max(0, atoms.length - todoItems.length),
      }),
      changeSummary: {
        generatedItems: capped.length,
        prunedResolvedItems: Math.max(0, atoms.length - todoItems.length),
      },
      window: { from: windowFrom.toISOString(), to: now.toISOString() },
      items: capped,
      groupedByProvider: grouped,
      stats: buildStats(capped),
      version: "1.0",
    };
    const parsed = TodoListOutputSchema.parse(list);

    if (input.persist) {
      await this.persistSnapshot(
        parsed,
        input.mode,
        options?.generatedFromEvent,
      );
    }

    return parsed;
  }

  private async fetchAtoms(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<ActivityAtom[]> {
    const { data, error } = await this.supabase
      .from("activity_atoms")
      .select("*")
      .eq("user_id", userId)
      .gte("occurred_at", from.toISOString())
      .lte("occurred_at", to.toISOString())
      .order("occurred_at", { ascending: false })
      .limit(200);

    if (error)
      throw new Error(`Failed to fetch activity atoms: ${error.message}`);
    return (data ?? []) as ActivityAtom[];
  }

  private async fetchActiveIntegrations(
    userId: string,
  ): Promise<Integration[]> {
    const { data, error } = await this.supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active");

    if (error)
      throw new Error(`Failed to fetch integrations: ${error.message}`);
    return (data ?? []) as Integration[];
  }

  private async persistSnapshot(
    payload: TodoListOutput,
    mode: "latest" | "regenerate",
    generatedFromEvent?: string,
  ): Promise<void> {
    const { error } = await this.supabase.from("todo_snapshots").insert({
      user_id: payload.userId,
      mode,
      window_from: payload.window.from,
      window_to: payload.window.to,
      generated_from_event: generatedFromEvent ?? null,
      payload: payload as unknown as Json,
    });

    if (error)
      throw new Error(`Failed to persist todo snapshot: ${error.message}`);
  }
}

export function createTodoGenerator(
  supabase: SupabaseClient<Database>,
): TodoGenerator {
  return new TodoGenerator(supabase);
}
