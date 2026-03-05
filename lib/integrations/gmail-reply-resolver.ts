import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import * as db from "@/lib/supabase/db";
import { createLLM } from "@/packages/agents/lib/llm";
import { createTodoGenerator } from "@/lib/integrations";
import type { TodoItem } from "@/packages/agents/schemas/todo.schema";
import { z } from "zod";

const GMAIL_EMAIL_SENT_TRIGGER = "GMAIL_EMAIL_SENT_TRIGGER";
const REPLY_ANALYSIS_DAYS = 7;

export interface GmailSentEventPayload {
  thread_id?: string;
  message_id?: string;
  message_text?: string;
  message_timestamp?: string;
  subject?: string;
  sender?: string;
  recipients?: string;
  payload?: { body?: { data?: string }; snippet?: string };
}

/** Extract thread ID from Gmail sourceRef (threadId or parse from sourceUrl). */
function getThreadIdFromItem(item: TodoItem): string | null {
  const ref = item.sourceRef;
  if (!ref) return null;
  if (
    typeof ref === "object" &&
    "threadId" in ref &&
    typeof ref.threadId === "string"
  ) {
    return ref.threadId;
  }
  const url =
    typeof ref === "object" && "sourceUrl" in ref ? ref.sourceUrl : undefined;
  if (typeof url !== "string") return null;
  const match =
    url.match(/#inbox\/([a-f0-9]+)/i) ?? url.match(/\/#all\/([a-f0-9]+)/i);
  return match?.[1] ?? null;
}

const ReplyAnalysisSchema = z.object({
  action: z.enum(["done", "update", "in_progress", "no_change"]),
  reason: z.string().max(200).optional(),
  updatedTitle: z.string().max(200).optional(),
  updatedDueAt: z.string().optional(),
});

type ReplyAnalysis = z.infer<typeof ReplyAnalysisSchema>;

const REPLY_ANALYSIS_PROMPT = `You are a task-status inference engine. You receive an existing task (title + summary) that was created from an incoming email, and the user's outgoing reply in that same email thread. Your job is to infer the correct action.

## Actions

**done** – The reply's *semantic meaning* indicates the task obligation is fulfilled.
Signals: the user delivered the requested artifact, confirmed completion, sent the information that was asked for, or the conversation makes clear nothing further is needed from the user.

**update** – The reply commits to a concrete future action or timeline that changes when/how the task should be tracked.
Signals: explicit postponement with a date/time, scope change, delegation to someone else with a follow-up date. When you choose "update", you MUST set at least one of updatedTitle or updatedDueAt.

**in_progress** – The reply signals active, ongoing work without completion.
Signals: partial delivery ("here's part one"), explicit "working on it" language, request for clarification before finishing.

**no_change** – The reply carries no actionable status change for the task.
Signals: acknowledgments ("OK", "Thanks", "Got it"), forwarding without comment, auto-replies, signatures-only, pleasantries, or content unrelated to the task obligation.

## Rules
- Detect the user's language automatically; do not assume any particular language.
- Focus on the *intent* of the reply, not keywords. A one-word reply that fulfills the task obligation counts as "done".
- If the reply is ambiguous, prefer "no_change" over a wrong status update.
- For "update": use YYYY-MM-DD for updatedDueAt. Resolve relative dates (e.g. "tomorrow", "Friday") against today: {{today}}.
- For "done" or "no_change": omit updatedTitle and updatedDueAt.
- reason: one sentence explaining your decision.`;

async function analyzeReplyWithLlm(
  taskTitle: string,
  taskSummary: string,
  replyText: string,
  subject: string | undefined,
): Promise<ReplyAnalysis> {
  const llm = createLLM({ temperature: 0.1, maxTokens: 256 });
  const structuredLlm = llm.withStructuredOutput(ReplyAnalysisSchema, {
    name: "reply_analysis",
    strict: true,
    method: "jsonSchema",
  });

  const today = new Date().toISOString().split("T")[0];
  const systemPrompt = REPLY_ANALYSIS_PROMPT.replace("{{today}}", today);

  const userParts = [
    `Task title: "${taskTitle}"`,
    `Task summary: ${taskSummary}`,
    subject ? `Email subject: "${subject}"` : "",
    `\nUser's outgoing reply:\n"""\n${replyText}\n"""`,
  ];

  const result = await structuredLlm.invoke([
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userParts.filter(Boolean).join("\n") },
  ]);

  return ReplyAnalysisSchema.parse(result);
}

export interface ResolveGmailReplyResult {
  processed: number;
  updated: number;
  errors: string[];
}

/**
 * When user sends a Gmail reply, find matching tasks and update them based on LLM analysis.
 */
export async function resolveGmailReply(
  supabase: SupabaseClient<Database>,
  userId: string,
  payload: GmailSentEventPayload,
): Promise<ResolveGmailReplyResult> {
  const threadId = payload.thread_id?.trim();
  if (!threadId) {
    return { processed: 0, updated: 0, errors: ["Missing thread_id"] };
  }

  const parts: string[] = [];
  if (typeof payload.message_text === "string")
    parts.push(payload.message_text);
  if (typeof payload.payload?.snippet === "string")
    parts.push(payload.payload.snippet);
  const bodyData = payload.payload as { body?: { data?: string } } | undefined;
  if (typeof bodyData?.body?.data === "string") {
    try {
      parts.push(Buffer.from(bodyData.body.data, "base64").toString("utf-8"));
    } catch {
      // ignore decode errors
    }
  }
  const replyText = parts.filter(Boolean).join(" ").slice(0, 2000).trim();

  if (!replyText) {
    return { processed: 0, updated: 0, errors: ["No reply text to analyze"] };
  }

  const dateStrings: string[] = [];
  const today = new Date().toISOString().split("T")[0];
  for (let i = 0; i < REPLY_ANALYSIS_DAYS; i++) {
    const d = new Date(today + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    dateStrings.push(d.toISOString().split("T")[0]);
  }

  const { data: rows, error } = await db.selectMany(
    supabase,
    "todo_snapshots",
    { user_id: userId, date: dateStrings },
    { columns: "date, payload" },
  );

  if (error || !rows?.length) {
    return { processed: 0, updated: 0, errors: error ? [error.message] : [] };
  }

  const generator = createTodoGenerator(supabase);
  const toProcess: {
    snapshot: { date: string; items: TodoItem[] };
    item: TodoItem;
  }[] = [];

  for (const row of rows) {
    const dateStr = (row as { date: string }).date;
    const rawPayload = (row as { payload: unknown }).payload;
    if (!rawPayload || typeof rawPayload !== "object") continue;
    const items = (rawPayload as { items?: unknown[] }).items ?? [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as TodoItem;
      if (item.sourceProvider !== "gmail") continue;
      if (item.status === "done") continue;
      const itemThreadId = getThreadIdFromItem(item);
      if (itemThreadId !== threadId) continue;
      toProcess.push({
        snapshot: { date: dateStr, items: items as TodoItem[] },
        item,
      });
    }
  }

  const errors: string[] = [];
  let updated = 0;

  for (const { snapshot, item } of toProcess) {
    try {
      const analysis = await analyzeReplyWithLlm(
        item.title,
        item.summary,
        replyText,
        payload.subject,
      );
      if (analysis.action === "no_change") continue;

      const patch: {
        status?: TodoItem["status"];
        title?: string;
        dueAt?: string | null;
      } = {};
      if (analysis.action === "done") patch.status = "done";
      if (analysis.action === "in_progress") patch.status = "in_progress";
      if (analysis.action === "update") {
        patch.status = analysis.updatedDueAt ? "open" : undefined;
        if (analysis.updatedTitle) patch.title = analysis.updatedTitle;
        if (analysis.updatedDueAt)
          patch.dueAt = analysis.updatedDueAt.includes("T")
            ? analysis.updatedDueAt
            : `${analysis.updatedDueAt}T18:00:00.000Z`;
      }

      await generator.updateItemInSnapshot(
        userId,
        snapshot.date,
        item.id,
        patch,
      );
      updated++;
    } catch (err) {
      errors.push(
        `Item ${item.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    processed: toProcess.length,
    updated,
    errors,
  };
}

export { GMAIL_EMAIL_SENT_TRIGGER };
