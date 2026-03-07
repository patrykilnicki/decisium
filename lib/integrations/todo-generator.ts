import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase";
import type { Integration } from "@/types/database";
import * as db from "@/lib/supabase/db";
import { createLLM } from "@/packages/agents/lib/llm";
import {
  fetchGmailEmailsFull,
  fetchGmailMessagesForThread,
} from "@/packages/agents/lib/composio-gmail";
import {
  TodoListOutputSchema,
  type TodoItem,
  type TodoListOutput,
} from "@/packages/agents/schemas/todo.schema";
import { z } from "zod";
import type { TriageResult } from "./todo-triage-agent";

export interface TodoSnapshotRow {
  id: string;
  user_id: string;
  date: string;
  payload: Json;
  generated_from_event: string | null;
  created_at: string | null;
}

export interface SignalHint {
  threadId?: string;
  messageId?: string;
  subject?: string;
  /** Calendar event external ID (e.g. from Composio trigger). */
  eventId?: string;
}

/** User-configured scope for which emails can generate to-do tasks (from users.todo_email_scope). */
export interface TodoEmailScope {
  labelIdsAccepted?: string[];
  labelIdsBlocked?: string[];
  sendersAccepted?: string[];
  sendersBlocked?: string[];
}

/** Toggles for which sources/types of tasks to create (from users.todo_prompt_settings.toggles). */
export interface TodoPromptToggles {
  fromCalendar?: boolean;
  fromEmails?: boolean;
  replyTasks?: boolean;
  fromNewsletters?: boolean;
  prepForMeetings?: boolean;
  fromAutomatedBots?: boolean;
}

/** User prompt settings: toggles + custom instructions (users.todo_prompt_settings). */
export interface TodoPromptSettings {
  toggles?: TodoPromptToggles;
  customInstructions?: string | null;
}

const DEFAULT_TODO_PROMPT_TOGGLES: Required<TodoPromptToggles> = {
  fromCalendar: true,
  fromEmails: true,
  replyTasks: true,
  fromNewsletters: false,
  prepForMeetings: true,
  fromAutomatedBots: false,
};

function hasAnyScope(scope: TodoEmailScope | null | undefined): boolean {
  if (!scope) return false;
  return (
    (scope.labelIdsAccepted?.length ?? 0) > 0 ||
    (scope.labelIdsBlocked?.length ?? 0) > 0 ||
    (scope.sendersAccepted?.length ?? 0) > 0 ||
    (scope.sendersBlocked?.length ?? 0) > 0
  );
}

/** Serialize scope for todo_generation_logs.email_scope_used. Always returns an object so the log shows what was used (empty arrays = no filter). */
function scopeToLogJson(scope: TodoEmailScope | null): Json {
  return {
    labelIdsAccepted: scope?.labelIdsAccepted ?? [],
    labelIdsBlocked: scope?.labelIdsBlocked ?? [],
    sendersAccepted: scope?.sendersAccepted ?? [],
    sendersBlocked: scope?.sendersBlocked ?? [],
  } as Json;
}

/** Serialize prompt settings for todo_generation_logs.prompt_settings_used. Always returns an object (defaults when null) so the log shows what was effectively used. */
function promptSettingsToLogJson(settings: TodoPromptSettings | null): Json {
  const t = { ...DEFAULT_TODO_PROMPT_TOGGLES, ...settings?.toggles };
  return {
    toggles: {
      fromCalendar: t.fromCalendar,
      fromEmails: t.fromEmails,
      replyTasks: t.replyTasks,
      fromNewsletters: t.fromNewsletters,
      prepForMeetings: t.prepForMeetings,
      fromAutomatedBots: t.fromAutomatedBots,
    },
    customInstructions: settings?.customInstructions?.trim() ?? null,
  } as Json;
}

export interface TodoGenerateOptions {
  generatedFromEvent?: string;
  /** When merging, reason to set in payload.updatedBecause */
  updatedBecause?: TodoListOutput["updatedBecause"];
  /** Log run_type (e.g. "regenerate"). Default in generateForDate is "initial_generation". */
  runType?: string;
  /** When provided, filter fetched signals to only matching ones (webhook optimization). */
  signalHints?: SignalHint[];
}

const BATCH_SIZE = 7;

/** Sequential fallback when LangGraph triage fails (e.g. serverless/env issues). */
async function extractTasksSequential(
  signals: IntegrationSignal[],
  date: string,
  existingItems?: TodoItem[],
  systemPromptTemplate?: string | null,
): Promise<TriageResult> {
  const existingItemKeys = (existingItems ?? []).flatMap((item) =>
    buildTodoItemDedupKeys(item),
  );
  const existingSet = new Set(existingItemKeys);
  const allItems: TodoItem[] = [];
  const logs: {
    batchIndex: number;
    parsedCount: number;
    filteredCount: number;
    rawPreview: string;
  }[] = [];

  const llm = createLLM({ temperature: 0.15, maxTokens: 8192 });
  const systemPrompt =
    systemPromptTemplate ??
    TASK_EXTRACTION_PROMPT.replace(/\{\{targetDate\}\}/g, date);

  for (let i = 0; i < signals.length; i += BATCH_SIZE) {
    const batch = signals.slice(i, i + BATCH_SIZE);
    const context = signalsToPromptContext(batch);
    const userContent = `Extract tasks for ${date} from these integration signals:\n\n${context}`;
    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userContent },
    ];

    let parsed: LlmExtractedTask[] = [];
    try {
      const structuredLlm = llm.withStructuredOutput(
        LlmExtractedTaskArraySchema,
        { name: "todo_tasks", strict: true, method: "jsonSchema" },
      );
      const out = await structuredLlm.invoke(messages);
      if (Array.isArray(out)) parsed = out as LlmExtractedTask[];
    } catch {
      const response = await llm.invoke(messages);
      const rawText =
        typeof response.content === "string"
          ? response.content
          : Array.isArray(response.content)
            ? response.content
                .map((c) =>
                  typeof c === "string"
                    ? (c as string)
                    : ((c as { text?: string }).text ?? ""),
                )
                .join("")
            : "";
      const jsonStr = extractJsonArrayFromResponse(rawText);
      if (jsonStr) {
        try {
          const arr = JSON.parse(jsonStr);
          if (Array.isArray(arr)) parsed = arr as LlmExtractedTask[];
        } catch {
          /* ignore */
        }
      }
    }

    const items = processParsedTasksToItems(parsed, date, batch);
    logs.push({
      batchIndex: Math.floor(i / BATCH_SIZE),
      parsedCount: parsed.length,
      filteredCount: items.length,
      rawPreview: JSON.stringify(parsed).slice(0, 4_000),
    });

    for (const item of items) {
      const keys = buildTodoItemDedupKeys(item);
      if (keys.length === 0) continue;
      if (keys.some((k) => existingSet.has(k))) continue;
      for (const k of keys) existingSet.add(k);
      allItems.push(item);
    }
  }

  const batchCount = Math.ceil(signals.length / BATCH_SIZE);
  const extractionLog: TodoExtractionLog = {
    systemPrompt,
    userContent: `[fallback ${batchCount} batches]`,
    rawResponse: logs
      .map((l) => `[${l.batchIndex}] ${l.rawPreview}`)
      .join("\n---\n")
      .slice(0, 50_000),
    parsedCount: logs.reduce((s, l) => s + l.parsedCount, 0),
    filteredCount: allItems.length,
    extractedItemsForLog: allItems.map((i) => ({
      id: i.id,
      title: i.title,
      summary: i.summary,
      priority: i.priority,
      sourceProvider: i.sourceProvider,
      sourceType: i.sourceType,
      sourceExternalId: i.sourceRef?.externalId,
      confidence: i.confidence,
    })),
  };

  return {
    items: enrichGmailItemsWithSourceUrl(allItems, signals),
    extractionLog,
    batchCount,
    errors: [],
  };
}

async function runTriageSignals(
  signals: IntegrationSignal[],
  date: string,
  existingItems?: TodoItem[],
  promptSettings?: TodoPromptSettings | null,
): Promise<TriageResult> {
  const systemPromptTemplate = buildSystemPromptWithPreferences(
    date,
    promptSettings,
  );
  try {
    const { triageSignals } = await import("./todo-triage-agent");
    return await triageSignals(
      signals,
      date,
      existingItems,
      systemPromptTemplate ?? undefined,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      "[todo-generator] Triage agent failed, using sequential fallback:",
      msg,
    );
    return extractTasksSequential(
      signals,
      date,
      existingItems,
      systemPromptTemplate ?? undefined,
    );
  }
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
  const deletedDedupKeys = Array.isArray(raw.deletedDedupKeys)
    ? raw.deletedDedupKeys.filter((k): k is string => typeof k === "string")
    : undefined;
  return {
    ...raw,
    items: normalizedItems,
    deletedDedupKeys,
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

export interface CalendarEventSignal {
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

export interface GmailSignal {
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

export type IntegrationSignal = CalendarEventSignal | GmailSignal;

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

/** Gmail web URL to open a thread (uses threadId in hash). */
function buildGmailThreadUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
}

/**
 * For items sourced from Gmail, set sourceRef.sourceUrl so the UI can link to the email.
 * Looks up threadId from signals by messageId (sourceRef.externalId).
 */
export function enrichGmailItemsWithSourceUrl(
  items: TodoItem[],
  signals: IntegrationSignal[],
): TodoItem[] {
  const gmailByMessageId = new Map<string, GmailSignal>();
  for (const s of signals) {
    if (s.provider === "gmail") {
      const g = s as GmailSignal;
      if (g.messageId) gmailByMessageId.set(g.messageId, g);
    }
  }
  return items.map((item) => {
    if (item.sourceProvider !== "gmail" || !item.sourceRef?.externalId)
      return item;
    const gmail = gmailByMessageId.get(item.sourceRef.externalId);
    if (!gmail) return item;
    const threadId = gmail.threadId;
    return {
      ...item,
      sourceRef: {
        ...item.sourceRef,
        ...(threadId
          ? {
              sourceUrl: buildGmailThreadUrl(threadId),
              threadId,
            }
          : {}),
        sender: gmail.sender,
      },
    };
  });
}

/**
 * When webhook provides signalHints (threadId/messageId for Gmail, eventId for
 * calendar), keep only matching signals. Reduces processing for incremental webhooks.
 */
function filterSignalsByHints(
  signals: IntegrationSignal[],
  hints: SignalHint[],
): IntegrationSignal[] {
  const hintThreadIds = new Set(
    hints.map((h) => h.threadId).filter(Boolean) as string[],
  );
  const hintMessageIds = new Set(
    hints.map((h) => h.messageId).filter(Boolean) as string[],
  );
  const hintEventIds = new Set(
    hints.map((h) => h.eventId).filter(Boolean) as string[],
  );
  const hasGmailHints = hintThreadIds.size > 0 || hintMessageIds.size > 0;
  const hasCalendarHints = hintEventIds.size > 0;
  if (!hasGmailHints && !hasCalendarHints) return signals;

  return signals.filter((s) => {
    if (s.provider === "google_calendar") {
      if (hasCalendarHints) {
        return hintEventIds.has((s as CalendarEventSignal).externalId);
      }
      return true;
    }
    const g = s as GmailSignal;
    if (g.threadId && hintThreadIds.has(g.threadId)) return true;
    if (g.messageId && hintMessageIds.has(g.messageId)) return true;
    return !hasGmailHints;
  });
}

export function buildTodoItemDedupKeys(item: {
  sourceProvider: string;
  sourceType: string;
  title: string;
  sourceRef?: { externalId?: string; threadId?: string };
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
  if (
    item.sourceProvider === "gmail" &&
    item.sourceType === "message" &&
    item.sourceRef?.threadId?.trim()
  ) {
    keys.add(`thread:gmail:${item.sourceRef.threadId.trim()}`);
  }
  return [...keys];
}

function filterItemsByDeletedKeys(
  items: TodoItem[],
  deletedDedupKeys: string[] | undefined,
): TodoItem[] {
  if (!deletedDedupKeys?.length) return items;
  const deletedSet = new Set(deletedDedupKeys);
  return items.filter((item) => {
    const keys = buildTodoItemDedupKeys(item);
    return !keys.some((k) => deletedSet.has(k));
  });
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
 * Passes targetDate so thread context is limited to messages on or before that day
 * (e.g. for 06.02, context is 01.02–06.02, not messages from 07.02–10.02).
 * When scope is provided and has any lists, applies label/sender filters.
 * Semantics: empty accepted lists = accept all; only block lists (labelIdsBlocked, sendersBlocked) restrict.
 */
async function fetchGmailSignals(
  userId: string,
  date: string,
  scope?: TodoEmailScope | null,
): Promise<GmailSignal[]> {
  const gmailDate = date.replace(/-/g, "/");
  const nextDay = nextDayDateString(date).replace(/-/g, "/");
  const query = `after:${gmailDate} before:${nextDay}`;

  const opts = {
    query,
    withThreadContext: true,
    targetDate: date,
    ...(hasAnyScope(scope)
      ? {
          labelIdsAccepted: scope!.labelIdsAccepted,
          labelIdsBlocked: scope!.labelIdsBlocked,
          sendersAccepted: scope!.sendersAccepted,
          sendersBlocked: scope!.sendersBlocked,
        }
      : {}),
  };

  const parsed = await fetchGmailEmailsFull(userId, opts);

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

async function getTodoEmailScope(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<TodoEmailScope | null> {
  const { data, error } = await db.selectOne(
    supabase,
    "users",
    { id: userId },
    {
      columns: "todo_email_scope",
    },
  );
  if (error || !data) return null;
  const raw = (data as { todo_email_scope?: Json }).todo_email_scope;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  return {
    labelIdsAccepted: Array.isArray(obj.labelIdsAccepted)
      ? (obj.labelIdsAccepted as string[])
      : undefined,
    labelIdsBlocked: Array.isArray(obj.labelIdsBlocked)
      ? (obj.labelIdsBlocked as string[])
      : undefined,
    sendersAccepted: Array.isArray(obj.sendersAccepted)
      ? (obj.sendersAccepted as string[])
      : undefined,
    sendersBlocked: Array.isArray(obj.sendersBlocked)
      ? (obj.sendersBlocked as string[])
      : undefined,
  };
}

async function getTodoPromptSettings(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<TodoPromptSettings | null> {
  const { data, error } = await db.selectOne(
    supabase,
    "users",
    { id: userId },
    {
      columns: "todo_prompt_settings",
    },
  );
  if (error || !data) return null;
  const raw = (data as { todo_prompt_settings?: Json }).todo_prompt_settings;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const togglesRaw = obj.toggles;
  const toggles: TodoPromptToggles | undefined =
    togglesRaw && typeof togglesRaw === "object" && !Array.isArray(togglesRaw)
      ? (togglesRaw as TodoPromptToggles)
      : undefined;
  const customInstructions =
    typeof obj.customInstructions === "string"
      ? obj.customInstructions
      : obj.customInstructions === null
        ? null
        : undefined;
  return { toggles, customInstructions };
}

function buildPreferencesBlock(t: Required<TodoPromptToggles>): string {
  const lines: string[] = [
    "USER PREFERENCES (apply these over the rules below):",
    `Create tasks from calendar: ${t.fromCalendar ? "yes" : "no"}.`,
    `Create tasks from emails: ${t.fromEmails ? "yes" : "no"}.`,
    `Create reply/follow-up tasks from email threads: ${t.replyTasks ? "yes" : "no"}.`,
    `Create tasks from newsletters and marketing: ${t.fromNewsletters ? "yes" : "no"}.`,
    `Create tasks for meeting preparation (from calendar): ${t.prepForMeetings ? "yes" : "no"}.`,
    `Create tasks from automated/bot messages: ${t.fromAutomatedBots ? "yes" : "no"}.`,
  ];
  if (!t.replyTasks) {
    lines.push(
      "Do NOT create tasks whose sole action is replying to or following up on an email thread. Skip reply/follow-up tasks entirely.",
    );
  }
  if (!t.fromNewsletters) {
    lines.push(
      "Do NOT create tasks from newsletters, marketing emails, or promotional content — even if they mention a deadline or personal request.",
    );
  }
  if (!t.prepForMeetings) {
    lines.push(
      "Do NOT create tasks for meeting preparation or follow-up from calendar events (e.g. 'Prepare for X meeting', 'Deliverable for Y'). Calendar events may still be included as context; do not output a task for them when this is off.",
    );
  }
  if (!t.fromAutomatedBots) {
    lines.push(
      "Do NOT create tasks from automated or bot messages (e.g. CI/CD notifications, system alerts). Skip these unless the user explicitly enabled this.",
    );
  }
  return lines.join("\n");
}

/**
 * Build the full system prompt with USER PREFERENCES block and optional custom instructions.
 * Returns null when no settings (caller uses TASK_EXTRACTION_PROMPT only).
 */
export function buildSystemPromptWithPreferences(
  date: string,
  settings: TodoPromptSettings | null | undefined,
): string | null {
  if (!settings) return null;
  const t = { ...DEFAULT_TODO_PROMPT_TOGGLES, ...settings.toggles };
  const prefsBlock = buildPreferencesBlock(t);
  const custom = settings.customInstructions?.trim();
  const customBlock = custom
    ? `\n\nAdditional instructions from the user (apply these too): "${custom.replace(/"/g, '\\"')}"`
    : "";
  const basePrompt = renderTaskExtractionPrompt(t).replace(
    /\{\{targetDate\}\}/g,
    date,
  );
  return prefsBlock + customBlock + "\n\n" + basePrompt;
}

/**
 * Fetch only the signals implied by webhook hints (e.g. one Gmail thread).
 * Use when merge is triggered by a single new-email webhook: we fetch only that
 * thread instead of all emails for the day.
 * Returns null when hints require calendar or full fetch (caller uses fetchAllSignals).
 */
async function fetchSignalsForHints(
  supabase: SupabaseClient<Database>,
  userId: string,
  date: string,
  hints: SignalHint[],
): Promise<{
  signals: IntegrationSignal[];
  promptSettings: TodoPromptSettings | null;
  emailScopeUsed: TodoEmailScope | null;
} | null> {
  const hasEventId = hints.some((h) => Boolean(h.eventId));
  const threadIds = [
    ...new Set(hints.map((h) => h.threadId).filter(Boolean) as string[]),
  ];
  const hasGmailHints =
    threadIds.length > 0 || hints.some((h) => Boolean(h.messageId));
  if (hasEventId || !hasGmailHints) return null;
  if (threadIds.length === 0) return null;

  const [scope, promptSettings] = await Promise.all([
    getTodoEmailScope(supabase, userId),
    getTodoPromptSettings(supabase, userId),
  ]);

  const allParsed: Awaited<ReturnType<typeof fetchGmailMessagesForThread>> = [];
  for (const threadId of threadIds) {
    const messages = await fetchGmailMessagesForThread(userId, threadId, {
      targetDateYyyyMmDd: date,
    });
    allParsed.push(...messages);
  }
  if (allParsed.length === 0) {
    return {
      signals: [],
      promptSettings: promptSettings ?? null,
      emailScopeUsed: scope ?? null,
    };
  }

  let gmailSignals: GmailSignal[] = allParsed.map((msg) => ({
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

  if (hasAnyScope(scope)) {
    const blockedSenders = new Set(
      (scope!.sendersBlocked ?? []).map((e) => e.toLowerCase().trim()),
    );
    const blockedLabels = new Set(scope!.labelIdsBlocked ?? []);
    if (blockedSenders.size > 0 || blockedLabels.size > 0) {
      gmailSignals = gmailSignals.filter((s) => {
        if (blockedSenders.size > 0) {
          const senderEmail = (s.sender ?? "").toLowerCase().includes("<")
            ? (s.sender ?? "")
                .replace(/.*<([^>]+)>.*/, "$1")
                .trim()
                .toLowerCase()
            : (s.sender ?? "").trim().toLowerCase();
          if (blockedSenders.has(senderEmail)) return false;
        }
        if (
          blockedLabels.size > 0 &&
          s.labels.some((l) => blockedLabels.has(l))
        )
          return false;
        return true;
      });
    }
  }

  if (promptSettings?.toggles?.fromEmails === false) {
    gmailSignals = [];
  }

  return {
    signals: gmailSignals,
    promptSettings: promptSettings ?? null,
    emailScopeUsed: scope ?? null,
  };
}

/** Fetch signals from all registered integrations. Calendar from Supabase; Gmail via Composio. Uses user's todo_email_scope and todo_prompt_settings (filters by fromCalendar/fromEmails). */
async function fetchAllSignals(
  supabase: SupabaseClient<Database>,
  userId: string,
  date: string,
): Promise<{
  signals: IntegrationSignal[];
  promptSettings: TodoPromptSettings | null;
  /** Scope applied when fetching Gmail (for logging). Null = no filter. */
  emailScopeUsed: TodoEmailScope | null;
}> {
  const [scope, promptSettings] = await Promise.all([
    getTodoEmailScope(supabase, userId),
    getTodoPromptSettings(supabase, userId),
  ]);
  const calendarSignals = fetchCalendarSignalsFromSupabase(
    supabase,
    userId,
    date,
  ).catch((err) => {
    console.warn("[todo-generator] google_calendar fetch error:", err);
    return [] as CalendarEventSignal[];
  });
  const gmailSignals = fetchGmailSignals(userId, date, scope).catch((err) => {
    console.warn("[todo-generator] gmail fetch error:", err);
    return [] as GmailSignal[];
  });
  const [cal, gmail] = await Promise.all([calendarSignals, gmailSignals]);
  let signals: IntegrationSignal[] = [...cal, ...gmail];
  const t = promptSettings?.toggles ?? {};
  if (t.fromCalendar === false) {
    signals = signals.filter((s) => s.provider !== "google_calendar");
  }
  if (t.fromEmails === false) {
    signals = signals.filter((s) => s.provider !== "gmail");
  }
  return {
    signals,
    promptSettings: promptSettings ?? null,
    emailScopeUsed: scope ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════
// LLM-powered task extraction
// ═══════════════════════════════════════════════════════════════

const EMAIL_SNIPPET_MAX = 2000;
const EMAIL_THREAD_CONTEXT_MAX = 6000;

/**
 * Calendar event is a "meeting" (needs preparation task) when there is more than one
 * participant (owner + at least one other). Single or zero participants = time block / reserve.
 */
function isMeetingByParticipants(participants: string[]): boolean {
  return participants.length > 1;
}

export function signalsToPromptContext(signals: IntegrationSignal[]): string {
  return signals
    .map((signal) => {
      if (signal.provider === "google_calendar") {
        const s = signal as CalendarEventSignal;
        const meeting = isMeetingByParticipants(s.participants);
        const kindHint = meeting
          ? "Kind: Meeting (2+ participants) — create a preparation task per calendar rules."
          : "Kind: Time block (single or no participants) — create a task ONLY if title/description clearly describes concrete work; otherwise do NOT create a task.";
        const parts = [
          `[CALENDAR] "${s.title}"`,
          kindHint,
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
      const useThreadOnly =
        threadContext.length > 0 && threadContext.length >= snippet.length;
      const content = useThreadOnly
        ? threadContext
        : snippet.length > 0
          ? snippet
          : "(No content for this message; subject and sender may still imply an action.)";
      return [
        `[EMAIL] Subject: "${g.subject}" | From: ${g.sender} | Date: ${g.timestamp} | Labels: ${g.labels.join(", ")}`,
        `Content: ${content}`,
        `ID: ${g.messageId}`,
      ].join("\n");
    })
    .join("\n\n");
}

const REPLY_TASKS_SECTION_TEXT = `REPLY TASKS — strict evidence required:
Do NOT create a "reply" or "respond" task just because the user hasn't replied to a thread. A reply task is warranted ONLY when the thread content contains concrete evidence that a response is expected:
- The other party asked a direct question
- The other party made an explicit request (send something, confirm, decide, approve)
- The user previously committed to follow up or deliver something
If the last message in the thread is a neutral statement, acknowledgment, or informational update with no question or request directed at the user — skip it entirely. Closing messages (e.g. "OK", "Thanks", "Got it", "Noted", confirmations) do not require a response and must NOT generate a task.
If the LAST message in the thread is from the user (the account owner / recipient — check who sent the final part of the conversation in the Content), do NOT create a reply or follow-up task for that thread; the user has already responded.

`;

const TASK_EXTRACTION_TEMPLATE = `You are an intelligent task extraction system for a personal productivity app.

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
- {{calendarGuidance}}
- CALENDAR RULES (apply in order): Each calendar signal is labeled "Kind: Meeting" or "Kind: Time block". (1) If Kind: Meeting (2+ participants): create exactly one meeting-preparation task based on title, description, and participants. (2) If Kind: Time block (single or no participants): create a task ONLY when the title and/or description semantically describe concrete work to be done (e.g. "create website", "draft proposal", "review document"). Use semantic understanding, not keyword lists. Do NOT create a task for generic reserves like "Focus time", "Deep work", "Block", "Reserve", "Busy" — those are just time blocks; omit them from your output.
- For emails: read the Content section (preview and thread context) in full. Is the user expected to respond, take action, or make a decision — or is this informational / automated / marketing?
- For email threads: read the full conversation flow in the Content. The Content shows messages in chronological order; "From:" or the sender name indicates who wrote each part. Who spoke last? Is the ball in the user's court? If the other party asked a question or is waiting for the user to reply, send something, or follow up — create a task. This includes Re: threads from colleagues, clients, or support.

{{replyTasksSection}}{{skipRules}}
For everything else — create a task if there is any reasonable chance the user should act. When in doubt, include a task; missing an actionable signal is worse than including a borderline one.

TASK RULES:
1. Each task dueAt MUST be "{{targetDate}}T00:00:00.000Z".
2. Do NOT create duplicate tasks for the same underlying action. For email threads: at most ONE task per conversation (one per thread); if multiple signals belong to the same thread, output only one task for that thread (the single most actionable one), and only if the user has not already replied (last message in the thread is not from the user).
3. Write titles as concise action items starting with a verb. Always output all generated text (title, summary, suggestedNextAction, actionabilityEvidence, urgentReason) in English, regardless of the signal language.
4. Set confidence (0.0–1.0) reflecting how certain you are that user action is truly required.
5. Set actionabilityEvidence: a short quote or fact from the signal that proves the user must act.

PRIORITY — two levels:
- "normal" (default): most tasks.
- "urgent": ONLY when you find explicit evidence of time pressure in the signal content — someone directly waiting for the user, a hard same-day deadline, or a scheduled commitment with a specific time. You MUST set "urgentReason" with a concrete fact from the signal. Do NOT use the word "today" in urgentReason — use the actual date or time from the signal instead (e.g. "Scheduled at 09:00 UTC" or "Deadline 2026-03-04").
  If you cannot quote a specific sentence or fact that proves it cannot wait, use "normal".

Return a JSON array. Each object (all string fields in English):
{
  "title": "short actionable title in English (max 80 chars)",
  "summary": "one sentence in English explaining what needs to be done",
  "priority": "normal" or "urgent",
  "urgentReason": "only when urgent — concrete fact from the signal, max ~80 chars. Do not use the word 'today'; use date/time from the signal. Omit for normal.",
  "sourceProvider": "google_calendar" or "gmail",
  "sourceType": "calendar_event" or "message",
  "sourceExternalId": "ID from the source signal",
  "actionabilityEvidence": "short quote or fact in English proving user action is required",
  "confidence": 0.0 to 1.0,
  "suggestedNextAction": "concrete next step in English the user should take",
  "tags": ["relevant", "tags"]
}

Return ONLY the JSON array. No markdown, no explanation.
{{examplesLine}}
You must output a task for every signal that meets the criteria above — do not limit how many tasks you return. If 10 signals are actionable, return 10 tasks. Omitting an actionable signal is an error.
Return [] only when no signal implies a concrete user action.`;

function buildCalendarGuidance(t: Required<TodoPromptToggles>): string {
  if (!t.prepForMeetings) {
    return "For calendar events: do NOT create preparation or deliverable tasks. Treat calendar events as context only; do not output a task for them.";
  }
  return "For calendar events: use the Kind label (Meeting vs Time block) and participant count. Meetings (2+ participants): create one preparation task. Time blocks (1 or 0 participants): create a task only if title/description clearly describe actionable work; otherwise skip (time reserve).";
}

function buildSkipRules(t: Required<TodoPromptToggles>): string {
  if (t.fromNewsletters && t.fromAutomatedBots) return "";
  if (t.fromNewsletters) {
    return "Skip automated notifications (e.g. CI/CD bot comments) unless they contain a personal request or deadline directed at the user.";
  }
  if (t.fromAutomatedBots) {
    return "Skip pure marketing, newsletters, and promotional offers unless they contain a personal request or deadline directed at the user.";
  }
  return "Skip pure marketing, newsletters, and automated notifications (e.g. CI/CD bot comments, promotional offers) unless they contain a personal request or deadline directed at the user.";
}

function buildExamples(t: Required<TodoPromptToggles>): string {
  const parts: string[] = [];
  if (t.prepForMeetings) parts.push("meetings to prepare for");
  if (t.replyTasks) parts.push("emails that need reply");
  parts.push("payments to confirm");
  parts.push(
    "support replies that ask the user to send a document or complete a step",
  );
  if (t.replyTasks)
    parts.push("messages from colleagues or clients asking for a response");
  return `Create tasks for clear action items (e.g. ${parts.join(", ")}).`;
}

function renderTaskExtractionPrompt(
  toggles: Required<TodoPromptToggles>,
): string {
  return TASK_EXTRACTION_TEMPLATE.replace(
    "{{calendarGuidance}}",
    buildCalendarGuidance(toggles),
  )
    .replace(
      "{{replyTasksSection}}",
      toggles.replyTasks ? REPLY_TASKS_SECTION_TEXT : "",
    )
    .replace("{{skipRules}}", buildSkipRules(toggles))
    .replace("{{examplesLine}}", buildExamples(toggles));
}

export const TASK_EXTRACTION_PROMPT = renderTaskExtractionPrompt(
  DEFAULT_TODO_PROMPT_TOGGLES,
);

/** Zod schema for LLM-extracted task (matches prompt format). Used for structured output (OpenRouter/OpenAI). Optional fields use .nullable() so the API can omit them; see https://platform.openai.com/docs/guides/structured-outputs */
export const LlmExtractedTaskSchema = z.object({
  title: z.string(),
  summary: z.string(),
  priority: z.enum(["normal", "urgent"]),
  urgentReason: z.string().nullable(),
  sourceProvider: z.string(),
  sourceType: z.string(),
  sourceExternalId: z.string().nullable(),
  actionabilityEvidence: z.string().nullable(),
  confidence: z.number().nullable(),
  suggestedNextAction: z.string(),
  tags: z.array(z.string()).nullable(),
});
export const LlmExtractedTaskArraySchema = z.array(LlmExtractedTaskSchema);

export interface LlmExtractedTask {
  title: string;
  summary: string;
  priority: "normal" | "urgent";
  urgentReason: string | null;
  sourceProvider: string;
  sourceType: string;
  sourceExternalId: string | null;
  actionabilityEvidence: string | null;
  confidence: number | null;
  suggestedNextAction: string;
  tags: string[] | null;
}

function llmTaskToTodoItem(task: LlmExtractedTask, date: string): TodoItem {
  // Urgent only if model set urgent AND gave a concrete reason (from thread); otherwise force normal
  const hasUrgentReason =
    typeof task.urgentReason === "string" &&
    task.urgentReason.trim().length >= 5;
  const priority =
    task.priority === "urgent" && hasUrgentReason ? "urgent" : "normal";
  const rawUrgentReason =
    priority === "urgent" && task.urgentReason
      ? task.urgentReason.trim().slice(0, 200)
      : undefined;
  // Do not use "today" in urgentReason; replace with target date
  const urgentReason = rawUrgentReason
    ? rawUrgentReason.replace(/\btoday\b/gi, date).trim()
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
    sourceRef: { externalId: task.sourceExternalId ?? undefined },
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

/**
 * For Gmail items with threadId, keep at most one per thread (highest confidence).
 * Used after enrichGmailItemsWithSourceUrl so threadId is available.
 */
export function oneTaskPerGmailThread(items: TodoItem[]): TodoItem[] {
  const byThread = new Map<string, TodoItem>();
  const rest: TodoItem[] = [];
  for (const item of items) {
    if (
      item.sourceProvider === "gmail" &&
      item.sourceType === "message" &&
      item.sourceRef?.threadId
    ) {
      const current = byThread.get(item.sourceRef.threadId);
      if (!current || (item.confidence ?? 0) > (current.confidence ?? 0)) {
        byThread.set(item.sourceRef.threadId, item);
      }
    } else {
      rest.push(item);
    }
  }
  return [...rest, ...byThread.values()];
}

/**
 * Dedupe, filter, convert parsed LLM tasks to TodoItems, enrich Gmail URLs.
 * At most one Gmail task per thread (best by confidence). Shared by triage and sequential fallback.
 */
export function processParsedTasksToItems(
  parsed: LlmExtractedTask[],
  date: string,
  signals: IntegrationSignal[],
): TodoItem[] {
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
      if (current) mergedTask = chooseBetterExtractedTask(current, mergedTask);
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
  const enriched = enrichGmailItemsWithSourceUrl(items, signals);
  return oneTaskPerGmailThread(enriched);
}

/**
 * Extract JSON array from LLM response. Does NOT strip reasoning/thought blocks —
 * that is risky and can remove the real JSON (see docs/analysis-todo-llm-parsing.md).
 * Picks the longest array match when multiple exist (e.g. model emits "[]" plus real data).
 */
export function extractJsonArrayFromResponse(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const allMatches = raw.trim().match(/\[[\s\S]*\]/g);
  if (!allMatches || allMatches.length === 0) return null;
  return allMatches.reduce((a, b) => (a.length >= b.length ? a : b));
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

interface TodoSnapshotMetadata {
  snapshotId: string;
  userId: string;
  date: string;
  listId: string;
  generatedAt: string;
  updatedBecause: TodoListOutput["updatedBecause"];
  version: "1.0";
  deletedDedupKeys: string[];
  legacyItems?: TodoItem[];
}

interface TodoItemDbRow {
  user_id: string;
  id: string;
  date: string;
  title: string;
  summary: string;
  priority: "normal" | "urgent";
  urgent_reason: string | null;
  status: "open" | "in_progress" | "done";
  due_at: string | null;
  source_provider: string;
  source_type: string;
  source_ref: Json;
  confidence: number;
  tags: string[] | null;
  suggested_next_action: string;
}

function parseTodoUpdateReason(
  value: unknown,
): TodoListOutput["updatedBecause"] {
  const allowed: TodoListOutput["updatedBecause"][] = [
    "initial_generation",
    "new_integration_context",
    "webhook_change_detected",
    "manual_regeneration",
    "resolved_items_pruned",
    "no_changes_detected",
    "cached",
    "user_edit",
  ];
  if (typeof value !== "string") return "initial_generation";
  if (!allowed.includes(value as TodoListOutput["updatedBecause"]))
    return "initial_generation";
  return value as TodoListOutput["updatedBecause"];
}

function toTodoItem(row: TodoItemDbRow): TodoItem {
  const sourceRef =
    row.source_ref &&
    typeof row.source_ref === "object" &&
    !Array.isArray(row.source_ref)
      ? (row.source_ref as TodoItem["sourceRef"])
      : {};
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    priority: row.priority,
    urgentReason: row.urgent_reason ?? undefined,
    status: row.status,
    dueAt: row.due_at,
    sourceProvider: row.source_provider,
    sourceType: row.source_type,
    sourceRef,
    confidence: clampConfidence(row.confidence, 0.8),
    tags: Array.isArray(row.tags) ? row.tags : [],
    suggestedNextAction: row.suggested_next_action,
  };
}

function toTodoItemDbInsert(
  userId: string,
  date: string,
  item: TodoItem,
): Record<string, unknown> {
  return {
    user_id: userId,
    id: item.id,
    date,
    title: item.title,
    summary: item.summary,
    priority: item.priority,
    urgent_reason: item.urgentReason ?? null,
    status: item.status,
    due_at: item.dueAt,
    source_provider: item.sourceProvider,
    source_type: item.sourceType,
    source_ref: (item.sourceRef ?? {}) as Json,
    confidence: clampConfidence(item.confidence, 0.8),
    tags: item.tags,
    suggested_next_action: item.suggestedNextAction,
    updated_at: new Date().toISOString(),
  };
}

function toSnapshotPayload(payload: TodoListOutput): Record<string, unknown> {
  return {
    listId: payload.listId,
    userId: payload.userId,
    date: payload.date,
    generatedAt: payload.generatedAt,
    updatedBecause: payload.updatedBecause,
    stats: payload.stats,
    version: payload.version,
    deletedDedupKeys: payload.deletedDedupKeys ?? [],
  };
}

export class TodoGenerator {
  private supabase: SupabaseClient<Database>;

  constructor(supabase: SupabaseClient<Database>) {
    this.supabase = supabase;
  }

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
        emailScopeUsed: scopeToLogJson(null),
        promptSettingsUsed: promptSettingsToLogJson(null),
      });
      return TodoListOutputSchema.parse({
        ...existing,
        updatedBecause: "cached",
      });
    }
    return this.generateForDate(userId, date, options);
  }

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

  async mergeNewTasksForDate(
    userId: string,
    date: string,
    options?: TodoGenerateOptions,
  ): Promise<TodoListOutput> {
    const metadata = await this.getSnapshotMetadataForDate(userId, date);
    if (!metadata) return this.generateForDate(userId, date, options);
    const existingItems = await this.getTodoItemsForDate(
      userId,
      date,
      metadata,
    );

    let signals: IntegrationSignal[];
    let promptSettings: TodoPromptSettings | null;
    let emailScopeUsed: TodoEmailScope | null;

    if (options?.signalHints?.length) {
      const hinted = await fetchSignalsForHints(
        this.supabase,
        userId,
        date,
        options.signalHints,
      );
      if (hinted) {
        signals = hinted.signals;
        promptSettings = hinted.promptSettings;
        emailScopeUsed = hinted.emailScopeUsed;
      } else {
        const full = await fetchAllSignals(this.supabase, userId, date);
        signals = filterSignalsByHints(full.signals, options.signalHints);
        promptSettings = full.promptSettings;
        emailScopeUsed = full.emailScopeUsed;
      }
    } else {
      const full = await fetchAllSignals(this.supabase, userId, date);
      signals = full.signals;
      promptSettings = full.promptSettings;
      emailScopeUsed = full.emailScopeUsed;
    }

    if (signals.length === 0) {
      return TodoListOutputSchema.parse({
        listId: metadata.listId,
        userId,
        date,
        generatedAt: new Date().toISOString(),
        updatedBecause: "no_changes_detected",
        items: existingItems,
        stats: buildStats(existingItems),
        version: "1.0",
        deletedDedupKeys: metadata.deletedDedupKeys,
      });
    }

    const startedAt = Date.now();
    const triageResult = await runTriageSignals(
      signals,
      date,
      existingItems,
      promptSettings,
    );
    const durationMs = Date.now() - startedAt;

    await this.insertTodoGenerationLog(userId, date, {
      runType: "merge",
      generatedFromEvent: options?.generatedFromEvent,
      signalsCount: signals.length,
      signalsSummary: buildSignalsSummary(signals),
      extractionLog: triageResult.extractionLog,
      extractedCount: triageResult.items.length,
      durationMs,
      emailScopeUsed: scopeToLogJson(emailScopeUsed),
      promptSettingsUsed: promptSettingsToLogJson(promptSettings),
    });

    const newItemsFiltered = filterItemsByDeletedKeys(
      triageResult.items,
      metadata.deletedDedupKeys,
    );
    if (newItemsFiltered.length === 0) {
      return TodoListOutputSchema.parse({
        listId: metadata.listId,
        userId,
        date,
        generatedAt: new Date().toISOString(),
        updatedBecause: options?.updatedBecause ?? "no_changes_detected",
        items: existingItems,
        stats: buildStats(existingItems),
        version: "1.0",
        deletedDedupKeys: metadata.deletedDedupKeys,
      });
    }

    await this.insertOrUpsertTodoItemsForDate(userId, date, newItemsFiltered);
    const merged = [...existingItems, ...newItemsFiltered];
    const list = TodoListOutputSchema.parse({
      listId: metadata.listId,
      userId,
      date,
      generatedAt: new Date().toISOString(),
      updatedBecause: options?.updatedBecause ?? "webhook_change_detected",
      items: merged,
      stats: buildStats(merged),
      version: "1.0",
      deletedDedupKeys: metadata.deletedDedupKeys,
    });
    await this.upsertSnapshot(userId, date, list, options?.generatedFromEvent);
    return list;
  }

  async getCachedForDate(
    userId: string,
    date: string,
  ): Promise<TodoListOutput | null> {
    return this.getSnapshotForDate(userId, date);
  }

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

    const { data, error } = await this.supabase
      .from("todo_items")
      .select("*")
      .eq("user_id", userId)
      .in("date", dateStrings)
      .neq("status", "done");
    if (error) {
      console.warn(
        "[todo-generator] getOverdueItems select error:",
        error.message,
      );
      return [];
    }
    return (data ?? []).map((row) => {
      const item = toTodoItem(row as unknown as TodoItemDbRow);
      return { ...item, snapshotDate: (row as { date: string }).date };
    });
  }

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
    const metadata = await this.getSnapshotMetadataForDate(userId, date);
    if (!metadata) throw new Error(`No snapshot for date ${date}`);
    const item = await this.getTodoItemByDateAndId(userId, date, itemId);
    if (!item) throw new Error(`Item ${itemId} not found in snapshot`);
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.status !== undefined) updatePayload.status = patch.status;
    if (patch.title !== undefined) updatePayload.title = patch.title;
    if (patch.dueAt !== undefined) updatePayload.due_at = patch.dueAt;
    const { error } = await db.update(
      this.supabase,
      "todo_items",
      { user_id: userId, date, id: itemId },
      updatePayload as never,
    );
    if (error) throw new Error(`Failed to update todo item: ${error.message}`);
    return this.refreshSnapshotAndReturnList(
      userId,
      date,
      "user_edit",
      metadata.listId,
      metadata.deletedDedupKeys,
    );
  }

  async removeItemFromSnapshot(
    userId: string,
    date: string,
    itemId: string,
  ): Promise<TodoListOutput> {
    const metadata = await this.getSnapshotMetadataForDate(userId, date);
    if (!metadata) throw new Error(`No snapshot for date ${date}`);
    const row = await this.getTodoItemByDateAndId(userId, date, itemId);
    if (!row) throw new Error(`Item ${itemId} not found`);
    const deletedItem = toTodoItem(row);
    const { error } = await db.remove(this.supabase, "todo_items", {
      user_id: userId,
      date,
      id: itemId,
    });
    if (error) throw new Error(`Failed to remove todo item: ${error.message}`);
    const deleted = new Set(metadata.deletedDedupKeys ?? []);
    for (const key of buildTodoItemDedupKeys(deletedItem)) deleted.add(key);
    return this.refreshSnapshotAndReturnList(
      userId,
      date,
      "user_edit",
      metadata.listId,
      [...deleted],
    );
  }

  async moveItemToDate(
    userId: string,
    fromDate: string,
    toDate: string,
    itemId: string,
  ): Promise<{ from: TodoListOutput; to: TodoListOutput }> {
    const fromMetadata = await this.getSnapshotMetadataForDate(
      userId,
      fromDate,
    );
    if (!fromMetadata) throw new Error(`No snapshot for date ${fromDate}`);
    const existing = await this.getTodoItemByDateAndId(
      userId,
      fromDate,
      itemId,
    );
    if (!existing)
      throw new Error(`Item ${itemId} not found in snapshot ${fromDate}`);
    const { error } = await db.update(
      this.supabase,
      "todo_items",
      { user_id: userId, date: fromDate, id: itemId },
      {
        date: toDate,
        due_at: `${toDate}T00:00:00.000Z`,
        updated_at: new Date().toISOString(),
      } as never,
    );
    if (error) throw new Error(`Failed to move todo item: ${error.message}`);
    const from = await this.refreshSnapshotAndReturnList(
      userId,
      fromDate,
      "user_edit",
      fromMetadata.listId,
      fromMetadata.deletedDedupKeys,
    );
    const toMeta = await this.getSnapshotMetadataForDate(userId, toDate);
    const to = await this.refreshSnapshotAndReturnList(
      userId,
      toDate,
      "user_edit",
      toMeta?.listId,
      toMeta?.deletedDedupKeys ?? [],
    );
    return { from, to };
  }

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
    const metadata = await this.getSnapshotMetadataForDate(userId, date);
    if (!metadata) return null;
    const items = await this.getTodoItemsForDate(userId, date, metadata);
    return TodoListOutputSchema.parse({
      listId: metadata.listId,
      userId,
      date,
      generatedAt: metadata.generatedAt,
      updatedBecause: metadata.updatedBecause,
      items,
      stats: buildStats(items),
      version: metadata.version,
      deletedDedupKeys: metadata.deletedDedupKeys,
    });
  }

  private async getSnapshotMetadataForDate(
    userId: string,
    date: string,
  ): Promise<TodoSnapshotMetadata | null> {
    const { data, error } = await db.selectOne(
      this.supabase,
      "todo_snapshots",
      { user_id: userId, date },
      { columns: "id, user_id, date, payload" },
    );
    if (error || !data) return null;
    const row = data as {
      id: string;
      user_id: string;
      date: string;
      payload: unknown;
    };
    const normalized = normalizeLegacyTodoPayload(row.payload) as
      | Record<string, unknown>
      | undefined;
    const payload = normalized ?? {};
    const legacyItems = Array.isArray(payload.items)
      ? (() => {
          try {
            return TodoListOutputSchema.parse({
              listId:
                typeof payload.listId === "string"
                  ? payload.listId
                  : crypto.randomUUID(),
              userId,
              date,
              generatedAt:
                typeof payload.generatedAt === "string"
                  ? payload.generatedAt
                  : new Date().toISOString(),
              updatedBecause: parseTodoUpdateReason(payload.updatedBecause),
              items: payload.items,
              stats: buildStats([]),
              version: "1.0",
              deletedDedupKeys: Array.isArray(payload.deletedDedupKeys)
                ? payload.deletedDedupKeys
                : [],
            }).items;
          } catch {
            return [];
          }
        })()
      : undefined;
    return {
      snapshotId: row.id,
      userId: row.user_id,
      date: row.date,
      listId:
        typeof payload.listId === "string"
          ? payload.listId
          : crypto.randomUUID(),
      generatedAt:
        typeof payload.generatedAt === "string"
          ? payload.generatedAt
          : new Date().toISOString(),
      updatedBecause: parseTodoUpdateReason(payload.updatedBecause),
      version: "1.0",
      deletedDedupKeys: Array.isArray(payload.deletedDedupKeys)
        ? payload.deletedDedupKeys.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
      legacyItems,
    };
  }

  private async getTodoItemsForDate(
    userId: string,
    date: string,
    metadata?: TodoSnapshotMetadata,
  ): Promise<TodoItem[]> {
    const { data, error } = await db.selectMany(this.supabase, "todo_items", {
      user_id: userId,
      date,
    });
    if (error) {
      console.warn(
        "[todo-generator] todo_items selectMany error:",
        error.message,
      );
      return metadata?.legacyItems ?? [];
    }
    const rows = (data ?? []) as unknown as TodoItemDbRow[];
    if (rows.length === 0 && metadata?.legacyItems?.length) {
      return metadata.legacyItems;
    }
    return rows.map(toTodoItem);
  }

  private async getTodoItemByDateAndId(
    userId: string,
    date: string,
    itemId: string,
  ): Promise<TodoItemDbRow | null> {
    const { data, error } = await db.selectOne(this.supabase, "todo_items", {
      user_id: userId,
      date,
      id: itemId,
    });
    if (error || !data) return null;
    return data as unknown as TodoItemDbRow;
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

    const { signals, promptSettings, emailScopeUsed } = await fetchAllSignals(
      this.supabase,
      userId,
      date,
    );
    if (signals.length === 0) {
      const empty = this.buildEmptyList(userId, date, "initial_generation");
      await this.replaceTodoItemsForDate(userId, date, []);
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
        emailScopeUsed: scopeToLogJson(emailScopeUsed),
        promptSettingsUsed: promptSettingsToLogJson(promptSettings),
      });
      return empty;
    }

    const existingMeta = await this.getSnapshotMetadataForDate(userId, date);
    const deletedDedupKeys = existingMeta?.deletedDedupKeys;
    const triageResult = await runTriageSignals(
      signals,
      date,
      undefined,
      promptSettings,
    );
    const durationMs = Date.now() - startedAt;

    const itemsFiltered = filterItemsByDeletedKeys(
      triageResult.items,
      deletedDedupKeys,
    );

    await this.insertTodoGenerationLog(userId, date, {
      runType: options?.runType ?? "initial_generation",
      generatedFromEvent: options?.generatedFromEvent,
      signalsCount: signals.length,
      signalsSummary: buildSignalsSummary(signals),
      extractionLog: triageResult.extractionLog,
      extractedCount: triageResult.items.length,
      durationMs,
      emailScopeUsed: scopeToLogJson(emailScopeUsed),
      promptSettingsUsed: promptSettingsToLogJson(promptSettings),
    });

    const list = TodoListOutputSchema.parse({
      listId: existingMeta?.listId ?? crypto.randomUUID(),
      userId,
      date,
      generatedAt: new Date().toISOString(),
      updatedBecause: "initial_generation",
      items: itemsFiltered,
      stats: buildStats(itemsFiltered),
      version: "1.0",
      deletedDedupKeys: deletedDedupKeys ?? [],
    });
    await this.replaceTodoItemsForDate(userId, date, list.items);
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

  private async replaceTodoItemsForDate(
    userId: string,
    date: string,
    items: TodoItem[],
  ): Promise<void> {
    const { error: removeError } = await db.remove(
      this.supabase,
      "todo_items",
      {
        user_id: userId,
        date,
      },
    );
    if (removeError) {
      throw new Error(`Failed to clear todo items: ${removeError.message}`);
    }
    await this.insertOrUpsertTodoItemsForDate(userId, date, items);
  }

  private async insertOrUpsertTodoItemsForDate(
    userId: string,
    date: string,
    items: TodoItem[],
  ): Promise<void> {
    if (items.length === 0) return;
    const rows = items.map((item) => toTodoItemDbInsert(userId, date, item));
    const { error } = await db.upsert(
      this.supabase,
      "todo_items",
      rows as never,
      { onConflict: "user_id,id" },
    );
    if (error) throw new Error(`Failed to upsert todo items: ${error.message}`);
  }

  private async refreshSnapshotAndReturnList(
    userId: string,
    date: string,
    reason: TodoListOutput["updatedBecause"],
    listId?: string,
    deletedDedupKeys: string[] = [],
  ): Promise<TodoListOutput> {
    const items = await this.getTodoItemsForDate(userId, date);
    const list = TodoListOutputSchema.parse({
      listId: listId ?? crypto.randomUUID(),
      userId,
      date,
      generatedAt: new Date().toISOString(),
      updatedBecause: reason,
      items,
      stats: buildStats(items),
      version: "1.0",
      deletedDedupKeys,
    });
    await this.upsertSnapshot(userId, date, list);
    return list;
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
        payload: toSnapshotPayload(payload) as Json,
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
      emailScopeUsed?: Json | null;
      promptSettingsUsed?: Json | null;
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
      email_scope_used: payload.emailScopeUsed ?? scopeToLogJson(null),
      prompt_settings_used:
        payload.promptSettingsUsed ?? promptSettingsToLogJson(null),
    };
    const { error } = await db.insertOne(
      this.supabase,
      "todo_generation_logs",
      logRow as never,
    );
    if (error) {
      console.warn(
        "[todo-generator] Failed to insert todo_generation_log:",
        error.message,
      );
    }
  }
}

export function createTodoGenerator(
  supabase: SupabaseClient<Database>,
): TodoGenerator {
  return new TodoGenerator(supabase);
}
