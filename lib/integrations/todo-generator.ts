import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase";
import type { ActivityAtom, Integration } from "@/types/database";
import {
  TodoItemSchema,
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

interface ScoredTodoItem extends TodoItem {
  _score: number;
}

function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function extractDueAt(atom: ActivityAtom): string | null {
  const metadata = (atom.metadata ?? {}) as Record<string, unknown>;
  const candidates = [
    metadata.dueAt,
    metadata.due_at,
    metadata.deadline,
    metadata.deadline_at,
    metadata.date,
  ];
  for (const candidate of candidates) {
    const iso = toIsoOrNull(candidate);
    if (iso) return iso;
  }
  return null;
}

function getPriorityFromScore(
  score: number,
): "low" | "medium" | "high" | "urgent" {
  if (score >= 0.85) return "urgent";
  if (score >= 0.65) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

function normalizeTitle(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function inferSourceType(atom: ActivityAtom): string {
  if (atom.atom_type === "event") return "calendar_event";
  if (atom.atom_type === "message") return "message";
  if (atom.atom_type === "task") return "task";
  return atom.atom_type;
}

function hasResolvedKeyword(value: string): boolean {
  const normalized = value.toLowerCase();
  const resolvedKeywords = [
    "done",
    "completed",
    "resolved",
    "cancelled",
    "canceled",
    "closed",
    "archived",
    "finished",
  ];
  return resolvedKeywords.some((keyword) => normalized.includes(keyword));
}

function shouldIncludeAtomAsTask(atom: ActivityAtom): boolean {
  const metadata = (atom.metadata ?? {}) as Record<string, unknown>;
  const status = String(metadata.status ?? "").toLowerCase();
  const explicitCompleted = metadata.completed === true;
  const explicitResolved = metadata.resolved === true;

  if (explicitCompleted || explicitResolved) return false;
  if (status.length > 0 && hasResolvedKeyword(status)) return false;

  const title = atom.title ?? "";
  const content = atom.content ?? "";
  if (hasResolvedKeyword(title) || hasResolvedKeyword(content)) return false;

  return true;
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

export function scoreAtomForTodo(atom: ActivityAtom): number {
  const text = `${atom.title ?? ""} ${atom.content ?? ""}`.toLowerCase();
  let score = 0.15;

  if (atom.provider === "linear" || atom.provider === "notion") score += 0.25;
  if (atom.provider === "gmail") score += 0.2;
  if (atom.provider === "google_calendar") score += 0.15;
  if (atom.atom_type === "task") score += 0.25;

  const urgencyKeywords = [
    "urgent",
    "asap",
    "today",
    "tomorrow",
    "deadline",
    "follow up",
    "action required",
    "todo",
  ];
  for (const keyword of urgencyKeywords) {
    if (text.includes(keyword)) {
      score += 0.08;
    }
  }

  if (atom.duration_minutes && atom.duration_minutes > 90) score += 0.05;
  if (Array.isArray(atom.participants) && atom.participants.length >= 3)
    score += 0.06;

  return Math.max(0, Math.min(1, score));
}

export function buildSuggestedAction(atom: ActivityAtom): string {
  if (atom.provider === "gmail")
    return "Draft and send a reply or archive this thread.";
  if (atom.provider === "google_calendar")
    return "Prepare notes and confirm meeting outcomes.";
  if (atom.provider === "linear")
    return "Update issue status and add next implementation step.";
  if (atom.provider === "notion")
    return "Convert this item into a tracked project task.";
  return "Review context and define the next concrete action.";
}

/** Exported for unit tests. */
export function toTodoItem(atom: ActivityAtom): TodoItem {
  const score = scoreAtomForTodo(atom);
  const content = atom.content ?? "";
  const rawTitle = atom.title?.trim() || content.slice(0, 80).trim();
  const title = rawTitle || "Untitled";
  const summary = content.trim().slice(0, 500) || "No description.";
  const item: TodoItem = {
    id: atom.id,
    title,
    summary,
    priority: getPriorityFromScore(score),
    status: "open",
    dueAt: extractDueAt(atom),
    sourceProvider: atom.provider,
    sourceType: inferSourceType(atom),
    sourceRef: {
      integrationId: atom.integration_id ?? undefined,
      activityAtomId: atom.id,
      externalId: atom.external_id,
      sourceUrl: atom.source_url ?? undefined,
    },
    confidence: Math.round(score * 100) / 100,
    tags: [atom.provider, atom.atom_type].filter(Boolean),
    suggestedNextAction: buildSuggestedAction(atom),
  };

  return TodoItemSchema.parse(item);
}

export function dedupeAndSortItems(items: TodoItem[]): TodoItem[] {
  const seen = new Set<string>();
  const scored: ScoredTodoItem[] = [];

  for (const item of items) {
    const key = `${item.sourceProvider}:${normalizeTitle(item.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const score =
      item.priority === "urgent"
        ? 1
        : item.priority === "high"
          ? 0.75
          : item.priority === "medium"
            ? 0.5
            : 0.25;
    scored.push({ ...item, _score: score });
  }

  scored.sort((a, b) => b._score - a._score);
  return scored.map(({ _score: _ignored, ...item }) => item);
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

export class TodoGenerator {
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

  private supabase: SupabaseClient<Database>;

  constructor(supabase: SupabaseClient<Database>) {
    this.supabase = supabase;
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

    const hasNewAtoms = (atomsResult.data?.length ?? 0) > 0;
    const hasUpdatedIntegrations = (integrationsResult.data?.length ?? 0) > 0;
    return hasNewAtoms || hasUpdatedIntegrations;
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

    const actionableAtoms = atoms.filter(shouldIncludeAtomAsTask);
    const prunedResolvedItems = Math.max(
      0,
      atoms.length - actionableAtoms.length,
    );
    const todoItems = dedupeAndSortItems(actionableAtoms.map(toTodoItem)).slice(
      0,
      input.maxItems,
    );
    const groupedByProvider = this.groupByProvider(todoItems, integrations);
    const list: TodoListOutput = {
      listId: crypto.randomUUID(),
      userId: input.userId,
      generatedAt: now.toISOString(),
      updatedBecause: getUpdateReason({
        generatedFromEvent: options?.generatedFromEvent,
        hadSnapshot,
        prunedResolvedItems,
      }),
      changeSummary: {
        generatedItems: todoItems.length,
        prunedResolvedItems,
      },
      window: { from: windowFrom.toISOString(), to: now.toISOString() },
      items: todoItems,
      groupedByProvider,
      stats: buildStats(todoItems),
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
      .order("occurred_at", { ascending: false });

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

  private groupByProvider(
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
