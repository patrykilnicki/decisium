import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase";
import type { Integration } from "@/types/database";
import { createLLM } from "@/packages/agents/lib/llm";
import {
  isComposioEnabled,
  listComposioConnectedAccounts,
  executeGoogleCalendarListEvents,
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

function toDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

// ═══════════════════════════════════════════════════════════════
// Live Composio data fetching
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

async function fetchCalendarSignals(
  userId: string,
  date: string,
): Promise<CalendarEventSignal[]> {
  if (!isComposioEnabled()) return [];

  const accounts = await listComposioConnectedAccounts(
    userId,
    "GOOGLECALENDAR",
  );
  if (accounts.length === 0) return [];

  const dayStart = `${date}T00:00:00Z`;
  const dayEnd = `${date}T23:59:59Z`;

  const result = await executeGoogleCalendarListEvents(userId, accounts[0].id, {
    timeMin: dayStart,
    timeMax: dayEnd,
    maxResults: 50,
    singleEvents: true,
  });

  if (!result.successful || !result.data?.items) return [];

  return result.data.items.map((item) => {
    const start = item.start as Record<string, unknown> | undefined;
    const end = item.end as Record<string, unknown> | undefined;
    const attendees = (item.attendees ?? []) as Array<{
      email?: string;
      displayName?: string;
    }>;

    return {
      provider: "google_calendar" as const,
      title: String(item.summary ?? "Untitled"),
      startTime: String(start?.dateTime ?? start?.date ?? ""),
      endTime: end?.dateTime ? String(end.dateTime) : undefined,
      participants: attendees
        .map((a) => a.displayName ?? a.email ?? "")
        .filter(Boolean),
      location: item.location ? String(item.location) : undefined,
      description: item.description
        ? String(item.description).slice(0, 300)
        : undefined,
      htmlLink: item.htmlLink ? String(item.htmlLink) : undefined,
      externalId: String(item.id ?? ""),
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

  const result = await executeGmailFetchEmails(userId, accounts[0].id, {
    query: `after:${date.replace(/-/g, "/")}`,
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

async function fetchAllSignals(
  userId: string,
  date: string,
): Promise<IntegrationSignal[]> {
  const [calendar, gmail] = await Promise.all([
    fetchCalendarSignals(userId, date).catch((err) => {
      console.warn("[todo-generator] Calendar fetch error:", err);
      return [] as CalendarEventSignal[];
    }),
    fetchGmailSignals(userId, date).catch((err) => {
      console.warn("[todo-generator] Gmail fetch error:", err);
      return [] as GmailSignal[];
    }),
  ]);

  return [...calendar, ...gmail];
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

You receive LIVE data from the user's connected integrations (Google Calendar, Gmail) for a specific date.

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
11. Priority: urgent (must do today), high (important), medium (should do), low (can wait).

Return a JSON array. Each object:
{
  "title": "short actionable title (max 80 chars)",
  "summary": "one sentence explaining what needs to be done",
  "priority": "low" | "medium" | "high" | "urgent",
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
  priority: "low" | "medium" | "high" | "urgent";
  sourceProvider: string;
  sourceType: string;
  sourceExternalId?: string;
  suggestedNextAction: string;
  tags?: string[];
}

function llmTaskToTodoItem(task: LlmExtractedTask, date: string): TodoItem {
  return {
    id: crypto.randomUUID(),
    title: task.title.slice(0, 120),
    summary: task.summary.slice(0, 500),
    priority: task.priority,
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

  private async getSnapshotForDate(
    userId: string,
    date: string,
  ): Promise<TodoListOutput | null> {
    const { data, error } = await this.supabase
      .from("todo_snapshots")
      .select("*")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle();

    if (error || !data) return null;

    try {
      return TodoListOutputSchema.parse(data.payload);
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

    const signals = await fetchAllSignals(userId, date);
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
        byPriority: { low: 0, medium: 0, high: 0, urgent: 0 },
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
    const { error } = await this.supabase.from("todo_snapshots").upsert(
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
    const { data, error } = await this.supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active");

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
