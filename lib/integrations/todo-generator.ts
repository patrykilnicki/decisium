import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase";
import type { Integration } from "@/types/database";
import * as db from "@/lib/supabase/db";
import { createLLM } from "@/packages/agents/lib/llm";
import {
  isComposioEnabled,
  listComposioConnectedAccounts,
  executeGmailFetchEmails,
} from "@/packages/agents/lib/composio";
import {
  TodoListOutputSchema,
  type TodoItem,
  type TodoListOutput,
} from "@/packages/agents/schemas/todo.schema";

export interface TodoSnapshotRow {
  id: string;
  user_id: string;
  date: string;
  payload: Json;
  generated_from_event: string | null;
  created_at: string | null;
}

export interface TodoGenerateOptions {
  generatedFromEvent?: string;
  /** When merging, reason to set in payload.updatedBecause */
  updatedBecause?: TodoListOutput["updatedBecause"];
}

function buildStats(items: TodoItem[]): TodoListOutput["stats"] {
  const byPriority = { normal: 0, urgent: 0 };
  const byProvider: Record<string, number> = {};
  for (const item of items) {
    byPriority[item.priority] += 1;
    byProvider[item.sourceProvider] =
      (byProvider[item.sourceProvider] ?? 0) + 1;
  }
  return { total: items.length, byPriority, byProvider };
}

/** Normalize legacy snapshot payload (old priority keys) to current schema for parse. */
function normalizeLegacyTodoPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const raw = payload as Record<string, unknown>;
  const items = Array.isArray(raw.items) ? raw.items : [];
  const normalizedItems = items.map((it: unknown) => {
    const item = it as Record<string, unknown>;
    const p = item.priority as string | undefined;
    const normal =
      p === "low" || p === "medium" || p === "high" || !p ? "normal" : "urgent";
    return { ...item, priority: normal };
  });
  const byPriority = { normal: 0, urgent: 0 };
  for (const it of normalizedItems) {
    const p = (it as { priority: string }).priority;
    byPriority[p === "urgent" ? "urgent" : "normal"] += 1;
  }
  const byProvider: Record<string, number> = {};
  for (const it of normalizedItems) {
    const prov = (it as { sourceProvider?: string }).sourceProvider ?? "";
    byProvider[prov] = (byProvider[prov] ?? 0) + 1;
  }
  return {
    ...raw,
    items: normalizedItems,
    stats: {
      ...(typeof raw.stats === "object" && raw.stats ? raw.stats : {}),
      total: normalizedItems.length,
      byPriority,
      byProvider,
    },
  };
}

function toDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

/** Next calendar day in YYYY-MM-DD (for Gmail before: end-of-day range). */
function nextDayDateString(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split("T")[0];
}

// ═══════════════════════════════════════════════════════════════
// Calendar: read from Supabase (activity_atoms). Write stays Composio.
// ═══════════════════════════════════════════════════════════════

interface CalendarEventSignal {
  provider: "google_calendar";
  title: string;
  startTime: string;
  endTime?: string;
  participants: string[];
  location?: string;
  description?: string;
  htmlLink?: string;
  externalId: string;
}

interface GmailSignal {
  provider: "gmail";
  subject: string;
  sender: string;
  snippet: string;
  timestamp: string;
  messageId: string;
  labels: string[];
}

type IntegrationSignal = CalendarEventSignal | GmailSignal;

/**
 * Fetch calendar events from Supabase (activity_atoms). Sync from Google runs
 * via Composio → activity_atoms; we read from DB to avoid duplicate API calls.
 */
async function fetchCalendarSignalsFromSupabase(
  supabase: SupabaseClient<Database>,
  userId: string,
  date: string,
): Promise<CalendarEventSignal[]> {
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  const { data, error } = await db.selectMany(
    supabase,
    "activity_atoms",
    { user_id: userId, atom_type: "event", provider: "google_calendar" },
    {
      columns:
        "title, occurred_at, duration_minutes, participants, source_url, external_id, content, metadata",
      rangeFilters: { occurred_at: { gte: dayStart, lte: dayEnd } },
      order: { column: "occurred_at", ascending: true },
    },
  );

  if (error) {
    console.warn(
      "[todo-generator] activity_atoms calendar fetch error:",
      error.message,
    );
    return [];
  }

  const rows = data ?? [];
  return rows.map((row) => {
    const startTime = row.occurred_at;
    let endTime: string | undefined;
    if (row.duration_minutes != null && row.duration_minutes > 0) {
      const end = new Date(
        new Date(startTime).getTime() + row.duration_minutes * 60 * 1000,
      );
      endTime = end.toISOString();
    }
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      provider: "google_calendar" as const,
      title: row.title ?? "Untitled",
      startTime,
      endTime,
      participants: Array.isArray(row.participants) ? row.participants : [],
      location:
        typeof metadata.location === "string" ? metadata.location : undefined,
      description: row.content ? String(row.content).slice(0, 300) : undefined,
      htmlLink: row.source_url ?? undefined,
      externalId: row.external_id,
    };
  });
}

async function fetchGmailSignals(
  userId: string,
  date: string,
): Promise<GmailSignal[]> {
  if (!isComposioEnabled()) return [];

  const accounts = await listComposioConnectedAccounts(userId, "GMAIL");
  if (accounts.length === 0) return [];

  // Single-day range: after start of day, before start of next day (same as Ask/adapters).
  const gmailDate = date.replace(/-/g, "/");
  const nextDay = nextDayDateString(date).replace(/-/g, "/");
  const result = await executeGmailFetchEmails(userId, accounts[0].id, {
    query: `after:${gmailDate} before:${nextDay}`,
    max_results: 50,
  });

  if (!result.successful || !result.data?.messages) return [];

  return result.data.messages.map((msg) => ({
    provider: "gmail" as const,
    subject: String(msg.subject ?? ""),
    sender: String(msg.sender ?? ""),
    snippet: String(msg.messageText ?? "").slice(0, 200),
    timestamp: String(msg.messageTimestamp ?? ""),
    messageId: String(msg.messageId ?? ""),
    labels: Array.isArray(msg.labelIds) ? (msg.labelIds as string[]) : [],
  }));
}

/** Fetch signals from all registered integrations. Calendar from Supabase; Gmail via Composio. */
async function fetchAllSignals(
  supabase: SupabaseClient<Database>,
  userId: string,
  date: string,
): Promise<IntegrationSignal[]> {
  const calendarSignals = fetchCalendarSignalsFromSupabase(
    supabase,
    userId,
    date,
  ).catch((err) => {
    console.warn("[todo-generator] google_calendar fetch error:", err);
    return [] as CalendarEventSignal[];
  });
  const gmailSignals = fetchGmailSignals(userId, date).catch((err) => {
    console.warn("[todo-generator] gmail fetch error:", err);
    return [] as GmailSignal[];
  });
  const [cal, gmail] = await Promise.all([calendarSignals, gmailSignals]);
  return [...cal, ...gmail];
}

// ═══════════════════════════════════════════════════════════════
// LLM-powered task extraction
// ═══════════════════════════════════════════════════════════════

function signalsToPromptContext(signals: IntegrationSignal[]): string {
  return signals
    .map((signal) => {
      if (signal.provider === "google_calendar") {
        const s = signal as CalendarEventSignal;
        const parts = [
          `[CALENDAR] "${s.title}"`,
          `Start: ${s.startTime}`,
          s.endTime ? `End: ${s.endTime}` : "",
          s.participants.length > 0
            ? `Participants: ${s.participants.join(", ")}`
            : "No participants",
          s.location ? `Location: ${s.location}` : "",
          s.description ? `Description: ${s.description}` : "",
          `ID: ${s.externalId}`,
        ];
        return parts.filter(Boolean).join(" | ");
      }
      const g = signal as GmailSignal;
      const parts = [
        `[EMAIL] Subject: "${g.subject}"`,
        `From: ${g.sender}`,
        `Date: ${g.timestamp}`,
        `Labels: ${g.labels.join(", ")}`,
        `Preview: ${g.snippet}`,
        `ID: ${g.messageId}`,
      ];
      return parts.filter(Boolean).join(" | ");
    })
    .join("\n");
}

const TASK_EXTRACTION_PROMPT = `You are an intelligent task extraction system for Decisium, a personal productivity app.

You receive data from the user's connected integrations for a specific date: calendar events from synced storage (Google Calendar), and emails from Gmail.

Extract ONLY genuinely actionable tasks — things the user needs to DO, PREPARE FOR, FOLLOW UP on, or RESPOND to on this specific date.

RULES:
1. Calendar events that are passive/personal (gym, barber, lunch, dinner, church, training) are NOT tasks.
2. Calendar meetings that need preparation (client call, presentation, project review, website work) ARE tasks.
3. Emails needing a reply, action, or decision ARE tasks. Promotional newsletters and marketing emails are NOT.
4. GitHub/Vercel notifications needing review ARE tasks.
5. Package delivery notifications needing action ARE tasks.
6. Billing/subscription issues needing resolution ARE tasks.
7. Each task dueAt MUST be set to the requested date: {{targetDate}}T00:00:00.000Z
8. Do NOT duplicate tasks for the same item.
9. Be selective — quality over quantity.
10. Write titles as concise action items (start with a verb). Keep in source language.
11. Priority: only two levels — "normal" (default) or "urgent". Use "urgent" only when something truly cannot wait (e.g. someone explicitly waiting for reply/action, deadline today, blocking others). When you set "urgent", you MUST set "urgentReason": a short explanation why (max ~80 chars), e.g. "Anna waiting for new version" or "Client call at 3pm".

Return a JSON array. Each object:
{
  "title": "short actionable title (max 80 chars)",
  "summary": "one sentence explaining what needs to be done",
  "priority": "normal" or "urgent",
  "urgentReason": "required only when priority is urgent — short reason (e.g. Anna waiting for new version)",
  "sourceProvider": "google_calendar" or "gmail",
  "sourceType": "calendar_event" or "message",
  "sourceExternalId": "ID from the source signal",
  "suggestedNextAction": "concrete next step",
  "tags": ["relevant", "tags"]
}

Return ONLY the JSON array. No markdown, no explanation. If nothing actionable, return [].`;

interface LlmExtractedTask {
  title: string;
  summary: string;
  priority: "normal" | "urgent";
  urgentReason?: string;
  sourceProvider: string;
  sourceType: string;
  sourceExternalId?: string;
  suggestedNextAction: string;
  tags?: string[];
}

function llmTaskToTodoItem(task: LlmExtractedTask, date: string): TodoItem {
  const priority = task.priority === "urgent" ? "urgent" : "normal";
  return {
    id: crypto.randomUUID(),
    title: task.title.slice(0, 120),
    summary: task.summary.slice(0, 500),
    priority,
    urgentReason:
      priority === "urgent" && task.urgentReason
        ? task.urgentReason.slice(0, 200)
        : undefined,
    status: "open",
    dueAt: `${date}T00:00:00.000Z`,
    sourceProvider: task.sourceProvider,
    sourceType: task.sourceType,
    sourceRef: {
      externalId: task.sourceExternalId || undefined,
    },
    confidence: 0.85,
    tags: task.tags ?? [task.sourceProvider],
    suggestedNextAction: task.suggestedNextAction,
  };
}

async function extractTasksWithLlm(
  signals: IntegrationSignal[],
  date: string,
): Promise<TodoItem[]> {
  if (signals.length === 0) return [];

  const llm = createLLM({ temperature: 0.15 });
  const prompt = TASK_EXTRACTION_PROMPT.replace(/\{\{targetDate\}\}/g, date);
  const context = signalsToPromptContext(signals);

  const response = await llm.invoke([
    { role: "system", content: prompt },
    {
      role: "user",
      content: `Extract tasks for ${date} from these integration signals:\n\n${context}`,
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
  if (!jsonMatch) {
    console.warn("[todo-generator] LLM returned no JSON array");
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as LlmExtractedTask[];
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const items: TodoItem[] = [];
    for (const task of parsed) {
      if (!task.title) continue;
      const key = `${task.sourceProvider}:${task.title.toLowerCase().trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(llmTaskToTodoItem(task, date));
    }
    return items;
  } catch (err) {
    console.error(
      "[todo-generator] Failed to parse LLM response:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// TodoGenerator — day-scoped, generate-once logic
// ═══════════════════════════════════════════════════════════════

export class TodoGenerator {
  private supabase: SupabaseClient<Database>;

  constructor(supabase: SupabaseClient<Database>) {
    this.supabase = supabase;
  }

  /**
   * Main entry point. Returns tasks for a given date.
   * If tasks already exist in the DB for that date, returns them.
   * If not, generates new ones from Composio + LLM and persists.
   */
  async getOrGenerateForDate(
    userId: string,
    date: string,
    options?: TodoGenerateOptions,
  ): Promise<TodoListOutput> {
    const existing = await this.getSnapshotForDate(userId, date);
    if (existing) {
      return TodoListOutputSchema.parse({
        ...existing,
        updatedBecause: "cached",
      });
    }

    return this.generateForDate(userId, date, options);
  }

  /**
   * Force regenerate tasks for a specific date (webhook / manual refresh).
   * Overwrites any existing snapshot for that date.
   */
  async regenerateForDate(
    userId: string,
    date: string,
    options?: TodoGenerateOptions,
  ): Promise<TodoListOutput> {
    return this.generateForDate(userId, date, options);
  }

  /**
   * Incremental update: fetch fresh signals, extract tasks, add only those not
   * already in the snapshot (by sourceRef.externalId). Use after webhook/sync
   * so new emails/events create only new tasks without overwriting existing.
   */
  async mergeNewTasksForDate(
    userId: string,
    date: string,
    options?: TodoGenerateOptions,
  ): Promise<TodoListOutput> {
    const existing = await this.getSnapshotForDate(userId, date);
    if (!existing) {
      return this.generateForDate(userId, date, options);
    }

    const signals = await fetchAllSignals(this.supabase, userId, date);
    if (signals.length === 0) {
      return TodoListOutputSchema.parse({
        ...existing,
        updatedBecause: "no_changes_detected",
      });
    }

    const extracted = await extractTasksWithLlm(signals, date);
    const existingExternalIds = new Set(
      existing.items
        .map((i) => i.sourceRef?.externalId)
        .filter((id): id is string => Boolean(id)),
    );
    const existingByKey = new Set(
      existing.items.map(
        (i) => `${i.sourceProvider}:${i.title.toLowerCase().trim()}`,
      ),
    );

    const newItems = extracted.filter((item) => {
      const id = item.sourceRef?.externalId;
      if (id && existingExternalIds.has(id)) return false;
      const key = `${item.sourceProvider}:${item.title.toLowerCase().trim()}`;
      if (existingByKey.has(key)) return false;
      return true;
    });

    if (newItems.length === 0) {
      return TodoListOutputSchema.parse({
        ...existing,
        generatedAt: new Date().toISOString(),
        updatedBecause: options?.updatedBecause ?? "no_changes_detected",
      });
    }

    const mergedItems = [...existing.items, ...newItems];
    const reason =
      options?.updatedBecause ??
      ("webhook_change_detected" as TodoListOutput["updatedBecause"]);

    const list: TodoListOutput = TodoListOutputSchema.parse({
      listId: existing.listId,
      userId: existing.userId,
      date: existing.date,
      generatedAt: new Date().toISOString(),
      updatedBecause: reason,
      items: mergedItems,
      stats: buildStats(mergedItems),
      version: "1.0",
    });

    await this.upsertSnapshot(userId, date, list, options?.generatedFromEvent);
    return list;
  }

  /**
   * Returns existing snapshot for the date if any. Never generates.
   * Use for "only from cache" reads (e.g. non-today dates before user clicks Generate).
   */
  async getCachedForDate(
    userId: string,
    date: string,
  ): Promise<TodoListOutput | null> {
    return this.getSnapshotForDate(userId, date);
  }

  /**
   * Overdue = open items from previous days. Returns items with snapshotDate so UI can show "From yesterday".
   * Fetches all relevant snapshots in one query (user_id + date in [yesterday, ...]) then parses payloads.
   * @param options.today - Reference date YYYY-MM-DD (e.g. client's local today); if omitted uses server date.
   */
  async getOverdueItems(
    userId: string,
    options?: { days?: number; today?: string },
  ): Promise<Array<TodoItem & { snapshotDate: string }>> {
    const days = options?.days ?? 2;
    const today =
      options?.today && /^\d{4}-\d{2}-\d{2}$/.test(options.today)
        ? options.today
        : toDateString(new Date());
    const dateStrings: string[] = [];
    for (let i = 1; i <= days; i++) {
      const d = new Date(today + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - i);
      dateStrings.push(toDateString(d));
    }
    if (dateStrings.length === 0) return [];

    const { data: rows, error } = await db.selectMany(
      this.supabase,
      "todo_snapshots",
      { user_id: userId, date: dateStrings },
      { columns: "date, payload" },
    );

    if (error) {
      console.warn(
        "[todo-generator] getOverdueItems selectMany error:",
        error.message,
      );
      return [];
    }

    const result: Array<TodoItem & { snapshotDate: string }> = [];
    for (const row of rows ?? []) {
      const dateStr = (row as { date: string }).date;
      const payload = (row as { payload: unknown }).payload;
      if (!dateStr || !payload) continue;
      try {
        const snapshot = TodoListOutputSchema.parse(
          normalizeLegacyTodoPayload(payload),
        );
        for (const item of snapshot.items) {
          if (item.status !== "done") {
            result.push({ ...item, snapshotDate: dateStr });
          }
        }
      } catch {
        // Skip snapshots with invalid or legacy payload shape
      }
    }
    return result;
  }

  /**
   * Update one item in a snapshot (status, title, or dueAt). Persists to DB.
   */
  async updateItemInSnapshot(
    userId: string,
    date: string,
    itemId: string,
    patch: {
      status?: TodoItem["status"];
      title?: string;
      dueAt?: string | null;
    },
  ): Promise<TodoListOutput> {
    const snapshot = await this.getSnapshotForDate(userId, date);
    if (!snapshot) throw new Error(`No snapshot for date ${date}`);
    const index = snapshot.items.findIndex((i) => i.id === itemId);
    if (index === -1) throw new Error(`Item ${itemId} not found in snapshot`);
    const items = [...snapshot.items];
    const next: TodoItem = { ...items[index], ...patch };
    if (patch.title != null) next.title = patch.title;
    if (patch.status != null) next.status = patch.status;
    if (patch.dueAt !== undefined) next.dueAt = patch.dueAt;
    items[index] = next;
    const list = TodoListOutputSchema.parse({
      ...snapshot,
      items,
      stats: buildStats(items),
      generatedAt: new Date().toISOString(),
      updatedBecause: "user_edit",
    });
    await this.upsertSnapshot(userId, date, list);
    return list;
  }

  /**
   * Remove one item from a snapshot (delete).
   */
  async removeItemFromSnapshot(
    userId: string,
    date: string,
    itemId: string,
  ): Promise<TodoListOutput> {
    const snapshot = await this.getSnapshotForDate(userId, date);
    if (!snapshot) throw new Error(`No snapshot for date ${date}`);
    const items = snapshot.items.filter((i) => i.id !== itemId);
    if (items.length === snapshot.items.length)
      throw new Error(`Item ${itemId} not found`);
    const list = TodoListOutputSchema.parse({
      ...snapshot,
      items,
      stats: buildStats(items),
      generatedAt: new Date().toISOString(),
      updatedBecause: "user_edit",
    });
    await this.upsertSnapshot(userId, date, list);
    return list;
  }

  /**
   * Move item from one date's snapshot to another. Creates target snapshot if needed.
   */
  async moveItemToDate(
    userId: string,
    fromDate: string,
    toDate: string,
    itemId: string,
  ): Promise<{ from: TodoListOutput; to: TodoListOutput }> {
    const fromSnapshot = await this.getSnapshotForDate(userId, fromDate);
    if (!fromSnapshot) throw new Error(`No snapshot for date ${fromDate}`);
    const item = fromSnapshot.items.find((i) => i.id === itemId);
    if (!item)
      throw new Error(`Item ${itemId} not found in snapshot ${fromDate}`);
    const fromItems = fromSnapshot.items.filter((i) => i.id !== itemId);
    const fromList = TodoListOutputSchema.parse({
      ...fromSnapshot,
      items: fromItems,
      stats: buildStats(fromItems),
      generatedAt: new Date().toISOString(),
      updatedBecause: "user_edit",
    });
    await this.upsertSnapshot(userId, fromDate, fromList);

    const movedItem: TodoItem = {
      ...item,
      dueAt: `${toDate}T00:00:00.000Z`,
    };
    let toSnapshot = await this.getSnapshotForDate(userId, toDate);
    if (!toSnapshot) {
      toSnapshot = this.buildEmptyList(userId, toDate, "user_edit");
    }
    const toItems = [...toSnapshot.items, movedItem];
    const toList = TodoListOutputSchema.parse({
      ...toSnapshot,
      items: toItems,
      stats: buildStats(toItems),
      generatedAt: new Date().toISOString(),
      updatedBecause: "user_edit",
    });
    await this.upsertSnapshot(userId, toDate, toList);
    return { from: fromList, to: toList };
  }

  /**
   * Lightweight check whether a snapshot exists for the given date (for UI labels).
   */
  async hasSnapshotForDate(userId: string, date: string): Promise<boolean> {
    const { data, error } = await db.selectOne(
      this.supabase,
      "todo_snapshots",
      { user_id: userId, date },
      { columns: "id" },
    );
    return !error && !!data;
  }

  private async getSnapshotForDate(
    userId: string,
    date: string,
  ): Promise<TodoListOutput | null> {
    const { data, error } = await db.selectOne(
      this.supabase,
      "todo_snapshots",
      { user_id: userId, date },
    );

    if (error || !data) return null;

    try {
      return TodoListOutputSchema.parse(
        normalizeLegacyTodoPayload((data as { payload: unknown }).payload),
      );
    } catch {
      return null;
    }
  }

  private async generateForDate(
    userId: string,
    date: string,
    options?: TodoGenerateOptions,
  ): Promise<TodoListOutput> {
    const integrations = await this.fetchActiveIntegrations(userId);
    if (integrations.length === 0) {
      return this.buildEmptyList(userId, date, "initial_generation");
    }

    const signals = await fetchAllSignals(this.supabase, userId, date);
    if (signals.length === 0) {
      const empty = this.buildEmptyList(userId, date, "initial_generation");
      await this.upsertSnapshot(
        userId,
        date,
        empty,
        options?.generatedFromEvent,
      );
      return empty;
    }

    const todoItems = await extractTasksWithLlm(signals, date);

    const list: TodoListOutput = TodoListOutputSchema.parse({
      listId: crypto.randomUUID(),
      userId,
      date,
      generatedAt: new Date().toISOString(),
      updatedBecause: "initial_generation",
      items: todoItems,
      stats: buildStats(todoItems),
      version: "1.0",
    });

    await this.upsertSnapshot(userId, date, list, options?.generatedFromEvent);
    return list;
  }

  private buildEmptyList(
    userId: string,
    date: string,
    reason: TodoListOutput["updatedBecause"],
  ): TodoListOutput {
    return TodoListOutputSchema.parse({
      listId: crypto.randomUUID(),
      userId,
      date,
      generatedAt: new Date().toISOString(),
      updatedBecause: reason,
      items: [],
      stats: {
        total: 0,
        byPriority: { normal: 0, urgent: 0 },
        byProvider: {},
      },
      version: "1.0",
    });
  }

  private async upsertSnapshot(
    userId: string,
    date: string,
    payload: TodoListOutput,
    generatedFromEvent?: string,
  ): Promise<void> {
    const { error } = await db.upsert(
      this.supabase,
      "todo_snapshots",
      {
        user_id: userId,
        date,
        generated_from_event: generatedFromEvent ?? null,
        payload: payload as unknown as Json,
      },
      { onConflict: "user_id,date" },
    );

    if (error)
      throw new Error(`Failed to persist todo snapshot: ${error.message}`);
  }

  private async fetchActiveIntegrations(
    userId: string,
  ): Promise<Integration[]> {
    const { data, error } = await db.selectMany(this.supabase, "integrations", {
      user_id: userId,
      status: "active",
    });

    if (error)
      throw new Error(`Failed to fetch integrations: ${error.message}`);
    return (data ?? []) as Integration[];
  }
}

export function createTodoGenerator(
  supabase: SupabaseClient<Database>,
): TodoGenerator {
  return new TodoGenerator(supabase);
}
