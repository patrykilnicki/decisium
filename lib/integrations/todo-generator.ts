import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase";
import type { Integration } from "@/types/database";
import * as db from "@/lib/supabase/db";
import { createLLM } from "@/packages/agents/lib/llm";
import { fetchGmailEmailsFull } from "@/packages/agents/lib/composio-gmail";
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
  /** Log run_type (e.g. "regenerate"). Default in generateForDate is "initial_generation". */
  runType?: string;
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
    const p = item.priority as string | number | undefined;
    // Pass through current schema; only map legacy values (low/medium/high, numbers, etc.)
    const normal: "normal" | "urgent" =
      p === "normal"
        ? "normal"
        : p === "urgent"
          ? "urgent"
          : p === "low" ||
              p === "medium" ||
              p === "high" ||
              p == null ||
              p === ""
            ? "normal"
            : "urgent";
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
  threadId?: string;
  threadContext?: string;
  labels: string[];
}

type IntegrationSignal = CalendarEventSignal | GmailSignal;

function normalizeTitleForKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampConfidence(value: unknown, fallback = 0.75): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function buildTodoItemDedupKeys(item: {
  sourceProvider: string;
  sourceType: string;
  title: string;
  sourceRef?: { externalId?: string };
}): string[] {
  const keys = new Set<string>();
  const normalizedTitle = normalizeTitleForKey(item.title);
  if (normalizedTitle) {
    keys.add(`provider_title:${item.sourceProvider}:${normalizedTitle}`);
    keys.add(`title:${normalizedTitle}`);
  }
  const externalId = item.sourceRef?.externalId?.trim();
  if (externalId) {
    keys.add(
      `external:${item.sourceProvider}:${item.sourceType}:${externalId}`,
    );
  }
  return [...keys];
}

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

/**
 * Fetch Gmail signals for a date. Uses the same API as the Ask flow's
 * fetch_gmail_emails tool: fetchGmailEmailsFull with withThreadContext: true,
 * so we get snippet + thread context for each message (same content quality as Ask).
 */
async function fetchGmailSignals(
  userId: string,
  date: string,
): Promise<GmailSignal[]> {
  const gmailDate = date.replace(/-/g, "/");
  const nextDay = nextDayDateString(date).replace(/-/g, "/");
  const query = `after:${gmailDate} before:${nextDay}`;

  const parsed = await fetchGmailEmailsFull(userId, {
    query,
    withThreadContext: true,
  });

  return parsed.map((msg) => ({
    provider: "gmail" as const,
    subject: msg.subject,
    sender: msg.sender,
    snippet: msg.snippet,
    timestamp: msg.timestamp,
    messageId: msg.messageId,
    threadId: msg.threadId,
    threadContext: msg.threadContext,
    labels: msg.labels,
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

/** Same limits as fetch_gmail_emails tool (Ask flow) for consistent content. */
const EMAIL_SNIPPET_MAX = 300;
const EMAIL_THREAD_CONTEXT_MAX = 900;

/**
 * Format integration signals for the LLM. Email format matches fetch_gmail_emails
 * tool output (same structure Ask uses) so the model sees subject, sender, snippet,
 * threadContext and can reason the same way as when summarizing emails in Ask.
 */
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
      const snippet = (g.snippet ?? "").trim().slice(0, EMAIL_SNIPPET_MAX);
      const threadContext = (g.threadContext ?? "")
        .trim()
        .slice(0, EMAIL_THREAD_CONTEXT_MAX);
      const hasContent = snippet.length > 0 || threadContext.length > 0;
      const content = hasContent
        ? [snippet, threadContext].filter(Boolean).join("\n\n")
        : '(No snippet or thread context for this message; subject and sender may still imply an action — e.g. personal reply, "Re:" thread.)';
      return [
        `[EMAIL] Subject: "${g.subject}" | From: ${g.sender} | Date: ${g.timestamp} | Labels: ${g.labels.join(", ")}`,
        `Content: ${content}`,
        `ID: ${g.messageId}`,
      ].join("\n");
    })
    .join("\n\n");
}

const TASK_EXTRACTION_PROMPT = `You are an intelligent task extraction system for a personal productivity app.

TARGET DATE: {{targetDate}}

You receive signals from the user's connected integrations — calendar events and emails — for the target date.
Each email is shown with its content (preview and/or thread context). Use the same approach as when summarizing emails for the user: read each email's content in detail before deciding if it requires action.

Your job: analyze every signal and decide whether it requires the user to take a concrete action.
Read each email's content (Subject, From, and Content section) in full before judging actionability—do not rely on subject line alone.
Use semantic understanding of the content, not keyword matching or hard-coded rules.
There is no predefined list of "actionable" or "non-actionable" categories — you must reason about each signal individually.

DECISION FRAMEWORK — ask yourself for each signal:
- Does this signal imply the user needs to DO something (reply, prepare, create, review, decide, deliver, follow up)?
- Is there evidence in the content that someone is waiting for the user, or that the user committed to something?
- For calendar events: does this meeting require preparation, deliverables, or follow-up — or is it passive attendance / personal time?
- For emails: read the Content section (preview and thread context) in full. Is the user expected to respond, take action, or make a decision — or is this informational / automated / marketing?
- For email threads: read the full conversation flow in the Content. Who spoke last? Is the ball in the user's court?

Skip pure marketing, newsletters, and automated notifications (e.g. CI/CD bot comments, promotional offers) unless they contain a personal request or deadline directed at the user.
For everything else — create a task if there is any reasonable chance the user should act.

TASK RULES:
1. Each task dueAt MUST be "{{targetDate}}T00:00:00.000Z".
2. Do NOT create duplicate tasks for the same underlying action.
3. Write titles as concise action items starting with a verb. Keep the source language of the signal.
4. Set confidence (0.0–1.0) reflecting how certain you are that user action is truly required.
5. Set actionabilityEvidence: a short quote or fact from the signal that proves the user must act.

PRIORITY — two levels:
- "normal" (default): most tasks.
- "urgent": ONLY when you find explicit evidence of time pressure in the signal content — someone directly waiting for the user, a hard same-day deadline, or a scheduled commitment today with a specific time. You MUST set "urgentReason" with a concrete fact from the signal.
  If you cannot quote a specific sentence or fact that proves it cannot wait, use "normal".

Return a JSON array. Each object:
{
  "title": "short actionable title (max 80 chars)",
  "summary": "one sentence explaining what needs to be done",
  "priority": "normal" or "urgent",
  "urgentReason": "only when urgent — concrete fact from the signal, max ~80 chars. Omit for normal.",
  "sourceProvider": "google_calendar" or "gmail",
  "sourceType": "calendar_event" or "message",
  "sourceExternalId": "ID from the source signal",
  "actionabilityEvidence": "short quote or fact proving user action is required",
  "confidence": 0.0 to 1.0,
  "suggestedNextAction": "concrete next step the user should take",
  "tags": ["relevant", "tags"]
}

Return ONLY the JSON array. No markdown, no explanation.
Create tasks for clear action items (e.g. meetings to prepare for, emails that need reply, payments to confirm).
Return [] only when no signal implies a concrete user action.`;

interface LlmExtractedTask {
  title: string;
  summary: string;
  priority: "normal" | "urgent";
  urgentReason?: string;
  sourceProvider: string;
  sourceType: string;
  sourceExternalId?: string;
  actionabilityEvidence?: string;
  confidence?: number;
  suggestedNextAction: string;
  tags?: string[];
}

function llmTaskToTodoItem(task: LlmExtractedTask, date: string): TodoItem {
  // Urgent only if model set urgent AND gave a concrete reason (from thread); otherwise force normal
  const hasUrgentReason =
    typeof task.urgentReason === "string" &&
    task.urgentReason.trim().length >= 5;
  const priority =
    task.priority === "urgent" && hasUrgentReason ? "urgent" : "normal";
  const urgentReason =
    priority === "urgent" && task.urgentReason
      ? task.urgentReason.trim().slice(0, 200)
      : undefined;
  return {
    id: crypto.randomUUID(),
    title: task.title.slice(0, 120),
    summary: task.summary.slice(0, 500),
    priority,
    urgentReason,
    status: "open",
    dueAt: `${date}T00:00:00.000Z`,
    sourceProvider: task.sourceProvider,
    sourceType: task.sourceType,
    sourceRef: {
      externalId: task.sourceExternalId || undefined,
    },
    confidence: clampConfidence(task.confidence, 0.8),
    tags: task.tags ?? [task.sourceProvider],
    suggestedNextAction: task.suggestedNextAction,
  };
}

function buildExtractedTaskDedupKeys(task: LlmExtractedTask): string[] {
  return buildTodoItemDedupKeys({
    sourceProvider: task.sourceProvider || "unknown",
    sourceType: task.sourceType || "unknown",
    title: task.title,
    sourceRef: { externalId: task.sourceExternalId },
  });
}

function isActionableExtractedTask(task: LlmExtractedTask): boolean {
  const confidence = clampConfidence(task.confidence, 0.7);
  const evidenceLength = task.actionabilityEvidence?.trim().length ?? 0;
  return confidence >= 0.45 || evidenceLength >= 12;
}

function chooseBetterExtractedTask(
  current: LlmExtractedTask,
  incoming: LlmExtractedTask,
): LlmExtractedTask {
  const currentScore =
    clampConfidence(current.confidence, 0.7) +
    (current.actionabilityEvidence?.trim().length ?? 0) / 200 +
    (current.summary?.length ?? 0) / 1000;
  const incomingScore =
    clampConfidence(incoming.confidence, 0.7) +
    (incoming.actionabilityEvidence?.trim().length ?? 0) / 200 +
    (incoming.summary?.length ?? 0) / 1000;
  return incomingScore > currentScore ? incoming : current;
}

export interface TodoExtractionLog {
  systemPrompt: string;
  userContent: string;
  rawResponse: string;
  parsedCount: number;
  filteredCount: number;
  extractedItemsForLog: unknown[];
}

/** Strip model reasoning/thought blocks so we parse only the JSON array. */
function stripReasoningFromResponse(raw: string): string {
  if (!raw || typeof raw !== "string") return raw;
  let out = raw.trim();
  out = out.replace(/\s*>\s*\{\s*thought[\s\S]*?\}\s*/gi, " ").trim();
  out = out.replace(/\s*\{\s*thought\s*\}\s*/gi, " ").trim();
  out = out.replace(/^\s*[a-zA-Z0-9_-]+\s*\n?/, "").trim();
  return out;
}

async function extractTasksWithLlm(
  signals: IntegrationSignal[],
  date: string,
): Promise<{ items: TodoItem[]; extractionLog: TodoExtractionLog | null }> {
  if (signals.length === 0) {
    return { items: [], extractionLog: null };
  }

  const llm = createLLM({ temperature: 0.15, maxTokens: 8192 });
  const systemPrompt = TASK_EXTRACTION_PROMPT.replace(
    /\{\{targetDate\}\}/g,
    date,
  );
  const context = signalsToPromptContext(signals);
  const userContent = `Extract tasks for ${date} from these integration signals:\n\n${context}`;

  const response = await llm.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ]);

  let text =
    typeof response.content === "string"
      ? response.content
      : Array.isArray(response.content)
        ? response.content
            .map((c) =>
              typeof c === "string" ? c : ((c as { text?: string }).text ?? ""),
            )
            .join("")
        : "";
  text = stripReasoningFromResponse(text);

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.warn("[todo-generator] LLM returned no JSON array");
    return {
      items: [],
      extractionLog: {
        systemPrompt,
        userContent,
        rawResponse: text.slice(0, 50_000),
        parsedCount: 0,
        filteredCount: 0,
        extractedItemsForLog: [],
      },
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as LlmExtractedTask[];
    if (!Array.isArray(parsed)) {
      return {
        items: [],
        extractionLog: {
          systemPrompt,
          userContent,
          rawResponse: jsonMatch[0].slice(0, 50_000),
          parsedCount: 0,
          filteredCount: 0,
          extractedItemsForLog: [],
        },
      };
    }

    const byKey = new Map<string, LlmExtractedTask>();
    for (const task of parsed) {
      if (!task.title?.trim()) continue;
      if (!task.summary?.trim()) continue;
      if (!task.sourceProvider?.trim()) continue;
      if (!task.sourceType?.trim()) continue;
      if (!isActionableExtractedTask(task)) continue;

      const keys = buildExtractedTaskDedupKeys(task);
      if (keys.length === 0) continue;

      let mergedTask = task;
      for (const key of keys) {
        const current = byKey.get(key);
        if (current)
          mergedTask = chooseBetterExtractedTask(current, mergedTask);
      }
      for (const key of keys) {
        byKey.set(key, mergedTask);
      }
    }

    const unique = new Map<string, LlmExtractedTask>();
    for (const task of byKey.values()) {
      const stableKey =
        buildExtractedTaskDedupKeys(task)[0] ??
        `${task.sourceProvider}:${normalizeTitleForKey(task.title)}`;
      unique.set(stableKey, task);
    }

    const items = [...unique.values()].map((task) =>
      llmTaskToTodoItem(task, date),
    );
    const extractedItemsForLog = items.map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      priority: item.priority,
      sourceProvider: item.sourceProvider,
      sourceType: item.sourceType,
      sourceExternalId: item.sourceRef?.externalId,
      confidence: item.confidence,
    }));

    return {
      items,
      extractionLog: {
        systemPrompt,
        userContent,
        rawResponse: jsonMatch[0].slice(0, 50_000),
        parsedCount: parsed.length,
        filteredCount: items.length,
        extractedItemsForLog,
      },
    };
  } catch (err) {
    console.error(
      "[todo-generator] Failed to parse LLM response:",
      err instanceof Error ? err.message : err,
    );
    return {
      items: [],
      extractionLog: {
        systemPrompt,
        userContent,
        rawResponse: jsonMatch[0].slice(0, 50_000),
        parsedCount: 0,
        filteredCount: 0,
        extractedItemsForLog: [],
      },
    };
  }
}

function buildSignalsSummary(signals: IntegrationSignal[]): Json {
  return signals.map((s) => {
    if (s.provider === "google_calendar") {
      const c = s as CalendarEventSignal;
      return {
        provider: c.provider,
        type: "calendar_event",
        title: c.title,
        externalId: c.externalId,
        startTime: c.startTime,
      };
    }
    const g = s as GmailSignal;
    return {
      provider: g.provider,
      type: "message",
      subject: g.subject,
      sender: g.sender,
      messageId: g.messageId,
      threadId: g.threadId ?? null,
      hasThreadContext: Boolean(g.threadContext),
    };
  }) as Json;
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
      await this.insertTodoGenerationLog(userId, date, {
        runType: "cached",
        generatedFromEvent: options?.generatedFromEvent,
        signalsCount: 0,
        signalsSummary: [],
        extractedCount: existing.items.length,
        durationMs: 0,
      });
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
    return this.generateForDate(userId, date, {
      ...options,
      runType: "regenerate",
    });
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

    const startedAt = Date.now();
    const { items: extracted, extractionLog } = await extractTasksWithLlm(
      signals,
      date,
    );
    const durationMs = Date.now() - startedAt;

    await this.insertTodoGenerationLog(userId, date, {
      runType: "merge",
      generatedFromEvent: options?.generatedFromEvent,
      signalsCount: signals.length,
      signalsSummary: buildSignalsSummary(signals),
      extractionLog,
      extractedCount: extracted.length,
      durationMs,
    });

    const existingKeys = new Set(
      existing.items.flatMap((item) => buildTodoItemDedupKeys(item)),
    );

    const newItems = extracted.filter((item) => {
      const keys = buildTodoItemDedupKeys(item);
      if (keys.some((key) => existingKeys.has(key))) return false;
      for (const key of keys) {
        existingKeys.add(key);
      }
      return keys.length > 0;
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
    const startedAt = Date.now();
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
      await this.insertTodoGenerationLog(userId, date, {
        runType: options?.runType ?? "initial_generation",
        generatedFromEvent: options?.generatedFromEvent,
        signalsCount: 0,
        signalsSummary: [] as Json,
        extractedCount: 0,
        durationMs: Date.now() - startedAt,
      });
      return empty;
    }

    const { items: todoItems, extractionLog } = await extractTasksWithLlm(
      signals,
      date,
    );
    const durationMs = Date.now() - startedAt;

    await this.insertTodoGenerationLog(userId, date, {
      runType: options?.runType ?? "initial_generation",
      generatedFromEvent: options?.generatedFromEvent,
      signalsCount: signals.length,
      signalsSummary: buildSignalsSummary(signals),
      extractionLog,
      extractedCount: todoItems.length,
      durationMs,
    });

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

  private async insertTodoGenerationLog(
    userId: string,
    date: string,
    payload: {
      runType: string;
      generatedFromEvent?: string;
      signalsCount: number;
      signalsSummary: Json;
      extractionLog?: TodoExtractionLog | null;
      extractedCount: number;
      durationMs: number;
      errorMessage?: string;
    },
  ): Promise<void> {
    const logRow = {
      user_id: userId,
      date,
      run_type: payload.runType,
      generated_from_event: payload.generatedFromEvent ?? null,
      signals_count: payload.signalsCount,
      signals_summary: payload.signalsSummary,
      llm_system_prompt_preview: payload.extractionLog
        ? payload.extractionLog.systemPrompt.slice(0, 8000)
        : null,
      llm_user_content_preview: payload.extractionLog
        ? payload.extractionLog.userContent.slice(0, 16000)
        : null,
      llm_raw_response: payload.extractionLog?.rawResponse ?? null,
      extracted_count: payload.extractedCount,
      extracted_items: (payload.extractionLog?.extractedItemsForLog ??
        []) as Json,
      duration_ms: payload.durationMs,
      error_message: payload.errorMessage ?? null,
    };
    const { error } = await db.insertOne(
      this.supabase,
      "todo_generation_logs",
      logRow as never,
    );
    if (error)
      console.warn(
        "[todo-generator] Failed to insert todo_generation_log:",
        error.message,
      );
  }
}

export function createTodoGenerator(
  supabase: SupabaseClient<Database>,
): TodoGenerator {
  return new TodoGenerator(supabase);
}
