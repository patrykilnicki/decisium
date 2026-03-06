import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import * as db from "@/lib/supabase/db";
import { createLLM } from "@/packages/agents/lib/llm";
import { createTodoGenerator } from "@/lib/integrations";
import type { TodoItem } from "@/packages/agents/schemas/todo.schema";
import {
  getGmailConnectedAccountId,
  enrichGmailMessagesWithThreadContext,
  type ParsedGmailMessage,
} from "@/packages/agents/lib/composio-gmail";
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
  /** Composio / provider may nest body under other keys */
  body?: { data?: string };
  snippet?: string;
  data?: unknown;
}

/** Extract readable text from nested payload (Composio can send body in various shapes). */
function extractReplyTextFromPayload(parts: string[], raw: unknown): void {
  if (raw == null) return;
  if (typeof raw === "string") {
    if (raw.trim().length > 0) parts.push(raw.trim());
    return;
  }
  if (typeof raw !== "object") return;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.message_text === "string" && obj.message_text.trim())
    parts.push(obj.message_text.trim());
  if (typeof obj.snippet === "string" && obj.snippet.trim())
    parts.push(obj.snippet.trim());
  if (typeof obj.text === "string" && obj.text.trim())
    parts.push(obj.text.trim());
  if (typeof obj.content === "string" && obj.content.trim())
    parts.push(obj.content.trim());
  const body = obj.body;
  if (
    body &&
    typeof body === "object" &&
    typeof (body as { data?: string }).data === "string"
  ) {
    try {
      const decoded = Buffer.from(
        (body as { data: string }).data,
        "base64",
      ).toString("utf-8");
      if (decoded.trim()) parts.push(decoded.trim());
    } catch {
      /* ignore */
    }
  }
  if (obj.payload && typeof obj.payload === "object")
    extractReplyTextFromPayload(parts, obj.payload);
  if (obj.data && typeof obj.data === "object")
    extractReplyTextFromPayload(parts, obj.data);
}

/**
 * Try to find thread_id from nested payload structures.
 * Composio may place it at different levels depending on trigger version.
 */
function extractThreadIdFromPayload(
  payload: GmailSentEventPayload,
): string | undefined {
  const candidates = [
    payload.thread_id,
    (payload.data as Record<string, unknown> | undefined)?.thread_id,
    (payload.data as Record<string, unknown> | undefined)?.threadId,
    (payload.payload as Record<string, unknown> | undefined)?.thread_id,
    (payload.payload as Record<string, unknown> | undefined)?.threadId,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return undefined;
}

/**
 * Fetch thread context for a given threadId via Gmail API (Composio).
 * Returns summarized conversation or empty string.
 */
async function fetchThreadContext(
  userId: string,
  threadId: string,
): Promise<string> {
  try {
    const connectedAccountId = await getGmailConnectedAccountId(userId);
    if (!connectedAccountId) return "";
    const stub: ParsedGmailMessage = {
      subject: "",
      sender: "",
      snippet: "",
      timestamp: "",
      messageId: "",
      threadId,
      labels: [],
    };
    const enriched = await enrichGmailMessagesWithThreadContext(
      userId,
      connectedAccountId,
      [stub],
    );
    return enriched[0]?.threadContext ?? "";
  } catch {
    return "";
  }
}

/** Remove universal email quote markers (>) so LLM sees cleaner content. No language-specific rules. */
function stripQuotedLines(text: string): string {
  if (!text.trim()) return "";
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n")
    .trim();
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

// OpenAI structured outputs require optional fields to use .nullable() – see
// https://platform.openai.com/docs/guides/structured-outputs#all-fields-must-be-required
const ReplyAnalysisSchema = z.object({
  action: z.enum(["done", "update", "in_progress", "no_change"]),
  confidence: z.number().min(0).max(1).optional().nullable(),
  reason: z.string().max(200).optional().nullable(),
  updatedTitle: z.string().max(200).optional().nullable(),
  updatedDueAt: z.string().optional().nullable(),
});

type ReplyAnalysis = z.infer<typeof ReplyAnalysisSchema>;

const REPLY_ANALYSIS_PROMPT = `You are a task-status inference engine. You receive an existing task (title, summary, and what completing it looks like) that was created from an incoming email, the original email thread for context, and the user's outgoing reply in that same email thread. The reply may include quoted/forwarded content (e.g. lines with ">", or blocks after "On ... wrote:"). Focus your analysis on the part the user newly wrote—usually the opening portion—and base your action on whether that new content fulfills the task. Your job is to infer the correct action.

## Actions

**done** – The reply's *semantic meaning* indicates the task obligation is fulfilled.
Signals: the user delivered the requested artifact, confirmed completion, sent the information that was asked for, or the conversation makes clear nothing further is needed from the user. If the task was to "reply with X" or "send X" and the user's message clearly contains or delivers X (e.g. a quote, confirmation, document, answer), choose "done".

**update** – The reply commits to a concrete future action or timeline that changes when/how the task should be tracked.
Signals: explicit postponement with a date/time, scope change, delegation to someone else with a follow-up date. When you choose "update", you MUST set at least one of updatedTitle or updatedDueAt.

**in_progress** – The reply signals active, ongoing work without completion.
Signals: partial delivery ("here's part one"), explicit "working on it" language, request for clarification before finishing.

**no_change** – The reply carries no actionable status change for the task.
Signals: acknowledgments ("OK", "Thanks", "Got it"), forwarding without comment, auto-replies, signatures-only, pleasantries, or content unrelated to the task obligation.

## Rules
- When an "Original email thread" is provided, use it to understand what was asked of the user and what the user was expected to do. This is the full conversation that led to the task creation. Compare the user's reply against these expectations.
- The reply may include quoted/forwarded content (e.g. "On ... wrote:", lines with ">"). Identify what the user newly wrote versus quoted thread, and base your decision on the user's new content only.
- Detect the user's language automatically; do not assume any particular language.
- Focus on the *intent* of the reply, not keywords. A one-word reply that fulfills the task obligation counts as "done".
- Compare the reply to "What completing the task looks like": if the user did that (e.g. sent a quote when the task was to send a quote), choose "done".
- If the reply is ambiguous, prefer "no_change" over a wrong status update.
- For "update": use YYYY-MM-DD for updatedDueAt. Resolve relative dates (e.g. "tomorrow", "Friday") against today: {{today}}.
- For "done" or "no_change": omit updatedTitle and updatedDueAt.
- confidence: a number 0.0–1.0 indicating how certain you are about your chosen action. 1.0 = absolutely certain, 0.5 = ambiguous/guessing.
- reason: one sentence explaining your decision.`;

async function analyzeReplyWithLlm(
  taskTitle: string,
  taskSummary: string,
  suggestedNextAction: string,
  replyText: string,
  subject: string | undefined,
  originalThreadContext?: string,
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
    `What completing the task looks like: ${suggestedNextAction}`,
    subject ? `Email subject: "${subject}"` : "",
    originalThreadContext
      ? `\nOriginal email thread (for context):\n"""\n${originalThreadContext.slice(0, 3000)}\n"""`
      : "",
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
  /** Diagnostic info logged alongside the result for debugging. */
  diagnostics?: {
    payloadKeys: string[];
    threadIdSource: string;
    replyTextLength: number;
    matchedItems: number;
    analyses: Array<{
      itemId: string;
      action: string;
      confidence: number | null;
      reason: string | null;
    }>;
  };
}

/**
 * When user sends a Gmail reply, find matching tasks and update them based on LLM analysis.
 */
export async function resolveGmailReply(
  supabase: SupabaseClient<Database>,
  userId: string,
  payload: GmailSentEventPayload,
): Promise<ResolveGmailReplyResult> {
  const payloadKeys = Object.keys(payload).filter(
    (k) => payload[k as keyof GmailSentEventPayload] != null,
  );
  console.log("[gmail-reply-resolver] payload keys:", payloadKeys.join(", "));

  const threadId = extractThreadIdFromPayload(payload);
  const threadIdSource = payload.thread_id?.trim()
    ? "top-level"
    : threadId
      ? "nested-fallback"
      : "missing";
  console.log(
    `[gmail-reply-resolver] thread_id=${threadId ?? "NONE"} (source: ${threadIdSource})`,
  );

  if (!threadId) {
    return {
      processed: 0,
      updated: 0,
      errors: ["Missing thread_id in all payload locations"],
      diagnostics: {
        payloadKeys,
        threadIdSource,
        replyTextLength: 0,
        matchedItems: 0,
        analyses: [],
      },
    };
  }

  const parts: string[] = [];
  if (typeof payload.message_text === "string" && payload.message_text.trim())
    parts.push(payload.message_text.trim());
  if (typeof payload.snippet === "string" && payload.snippet.trim())
    parts.push(payload.snippet.trim());
  if (
    typeof payload.payload?.snippet === "string" &&
    payload.payload.snippet.trim()
  )
    parts.push(payload.payload.snippet.trim());
  const bodyData = payload.payload as { body?: { data?: string } } | undefined;
  if (typeof bodyData?.body?.data === "string") {
    try {
      const decoded = Buffer.from(bodyData.body.data, "base64").toString(
        "utf-8",
      );
      if (decoded.trim()) parts.push(decoded.trim());
    } catch {
      // ignore decode errors
    }
  }
  if (payload.body?.data) {
    try {
      const decoded = Buffer.from(payload.body.data, "base64").toString(
        "utf-8",
      );
      if (decoded.trim()) parts.push(decoded.trim());
    } catch {
      /* ignore */
    }
  }
  extractReplyTextFromPayload(parts, payload.data);
  extractReplyTextFromPayload(parts, payload.payload);
  const rawReplyText = [...new Set(parts)]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000)
    .trim();
  const replyText = stripQuotedLines(rawReplyText) || rawReplyText;

  if (!replyText) {
    return {
      processed: 0,
      updated: 0,
      errors: ["No reply text to analyze"],
      diagnostics: {
        payloadKeys,
        threadIdSource,
        replyTextLength: 0,
        matchedItems: 0,
        analyses: [],
      },
    };
  }

  console.log(
    `[gmail-reply-resolver] replyText length=${replyText.length} preview="${replyText.slice(0, 120)}..."`,
  );

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
    return {
      processed: 0,
      updated: 0,
      errors: error ? [error.message] : [],
      diagnostics: {
        payloadKeys,
        threadIdSource,
        replyTextLength: replyText.length,
        matchedItems: 0,
        analyses: [],
      },
    };
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

  console.log(
    `[gmail-reply-resolver] matched ${toProcess.length} task(s) for thread ${threadId}`,
  );

  const originalThreadContext = await fetchThreadContext(userId, threadId);
  if (originalThreadContext) {
    console.log(
      `[gmail-reply-resolver] fetched thread context (${originalThreadContext.length} chars)`,
    );
  }

  const errors: string[] = [];
  let updated = 0;
  const analyses: NonNullable<
    ResolveGmailReplyResult["diagnostics"]
  >["analyses"] = [];

  for (const { snapshot, item } of toProcess) {
    try {
      const analysis = await analyzeReplyWithLlm(
        item.title,
        item.summary,
        item.suggestedNextAction ?? item.summary,
        replyText,
        payload.subject,
        originalThreadContext || undefined,
      );

      analyses.push({
        itemId: item.id,
        action: analysis.action,
        confidence: analysis.confidence ?? null,
        reason: analysis.reason ?? null,
      });

      console.log(
        `[gmail-reply-resolver] item=${item.id} action=${analysis.action} confidence=${analysis.confidence ?? "?"} reason="${analysis.reason ?? ""}"`,
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
    diagnostics: {
      payloadKeys,
      threadIdSource,
      replyTextLength: replyText.length,
      matchedItems: toProcess.length,
      analyses,
    },
  };
}

export { GMAIL_EMAIL_SENT_TRIGGER };
