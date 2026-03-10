import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { createLLM } from "@/packages/agents/lib/llm";
import { createTodoGenerator } from "@/lib/integrations";
import type { TodoItem } from "@/packages/agents/schemas/todo.schema";
import {
  getGmailConnectedAccountId,
  enrichGmailMessagesWithThreadContext,
  fetchMessageBodyPlainText,
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
  payload?: { body?: { data?: string }; snippet?: string; parts?: unknown[] };
  /** Composio / provider may nest body under other keys */
  body?: { data?: string };
  snippet?: string;
  data?: unknown;
}

/**
 * Decode body from a Gmail-style part (body.data base64).
 * Returns { plain: string } or { html: string } based on mimeType.
 */
function decodePartBody(part: Record<string, unknown>): {
  plain?: string;
  html?: string;
} {
  const body = part.body as { data?: string } | undefined;
  const data = body?.data;
  if (typeof data !== "string" || !data.trim()) return {};
  const mimeType = String(part.mimeType ?? part.mime_type ?? "").toLowerCase();
  try {
    const decoded = Buffer.from(data, "base64").toString("utf-8");
    if (!decoded.trim()) return {};
    if (mimeType === "text/plain") return { plain: decoded.trim() };
    if (mimeType === "text/html") return { html: decoded.trim() };
    return { plain: decoded.trim() };
  } catch {
    return {};
  }
}

/**
 * Extract reply text from payload. Prefer text/plain when present (Gmail API
 * uses payload.parts[] with mimeType; Composio may forward that). Otherwise
 * collect snippet/message_text/body and strip HTML — Composio does not
 * document GMAIL_EMAIL_SENT_TRIGGER body format, and providers often send HTML.
 */
function extractReplyTextFromPayload(parts: string[], raw: unknown): void {
  if (raw == null) return;
  if (typeof raw === "string") {
    if (raw.trim().length > 0) parts.push(raw.trim());
    return;
  }
  if (typeof raw !== "object") return;
  const obj = raw as Record<string, unknown>;

  const payloadParts =
    obj.parts ?? (obj.payload as Record<string, unknown> | undefined)?.parts;
  if (Array.isArray(payloadParts) && payloadParts.length > 0) {
    let plain: string | undefined;
    let html: string | undefined;
    for (const p of payloadParts) {
      if (p == null || typeof p !== "object") continue;
      const decoded = decodePartBody(p as Record<string, unknown>);
      if (decoded.plain) plain = decoded.plain;
      if (decoded.html) html = decoded.html;
    }
    if (plain) parts.push(plain);
    else if (html) parts.push(html);
  }

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
  if (
    obj.payload &&
    typeof obj.payload === "object" &&
    !Array.isArray(payloadParts)
  )
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

/** Extract message_id from payload (for fetching full message via Composio). */
function extractMessageIdFromPayload(
  payload: GmailSentEventPayload,
): string | undefined {
  const candidates = [
    payload.message_id,
    (payload.data as Record<string, unknown> | undefined)?.message_id,
    (payload.data as Record<string, unknown> | undefined)?.messageId,
    (payload.payload as Record<string, unknown> | undefined)?.message_id,
    (payload.payload as Record<string, unknown> | undefined)?.messageId,
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

/**
 * Strip HTML/CSS to plaintext so the LLM sees the actual message content.
 * Gmail API returns multipart messages (text/plain and/or text/html); Composio
 * does not document GMAIL_EMAIL_SENT_TRIGGER body format — in practice the
 * body is often raw HTML. Without stripping, the LLM sees only markup and
 * returns "no_change". Standard approach when plain text is not available.
 */
function stripHtmlToPlaintext(html: string): string {
  if (!html.trim()) return "";
  let out = html;
  out = out.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
  out = out.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ");
  out = out.replace(/<[^>]+>/g, " ");
  out = out.replace(/&nbsp;/gi, " ");
  out = out.replace(/&amp;/gi, "&");
  out = out.replace(/&lt;/gi, "<");
  out = out.replace(/&gt;/gi, ">");
  out = out.replace(/&quot;/gi, '"');
  out = out.replace(/&#?\w+;/g, " ");
  out = out.replace(/\s+/g, " ");
  return out.trim();
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

const REPLY_ANALYSIS_PROMPT = `Infer task status from a user's sent email reply.

You get:
- existing task (title, summary, completion expectation)
- original thread context (what was requested)
- user's outgoing reply (may include quoted text)

Use only the user's newly written content. Ignore quoted/forwarded thread text.

Actions:
- done: reply clearly fulfills the task obligation (delivered requested info/file/answer/confirmation; no further user action needed).
- update: reply changes plan/timing/scope; set updatedTitle and/or updatedDueAt.
- in_progress: work started but not finished.
- no_change: no reliable status change (acknowledgment, pleasantries, unrelated, auto-reply, ambiguous).

Strictness for done:
- choose done only with clear semantic evidence of completion.
- if unsure, choose no_change.

Rules:
- Compare reply to "What completing the task looks like".
- For update, use YYYY-MM-DD for updatedDueAt; resolve relative dates against {{today}}.
- Use English for reason and updatedTitle.
- For done or no_change, omit updatedTitle and updatedDueAt.
- confidence must be 0.0-1.0.
- reason: one short sentence in English with concrete evidence.`;

function normalizeAnalysisAction(analysis: ReplyAnalysis): ReplyAnalysis {
  const confidence = analysis.confidence ?? 0;
  if (analysis.action === "done" && confidence < 0.6) {
    return {
      ...analysis,
      action: "no_change",
      reason:
        analysis.reason ??
        "Reply likely does not provide clear completion evidence.",
    };
  }
  if (
    analysis.action === "update" &&
    !analysis.updatedDueAt &&
    !analysis.updatedTitle
  ) {
    return {
      ...analysis,
      action: "in_progress",
      reason:
        analysis.reason ??
        "Reply indicates progress but no concrete schedule/scope update.",
    };
  }
  return analysis;
}

async function analyzeReplyWithLlm(
  taskTitle: string,
  taskSummary: string,
  suggestedNextAction: string,
  replyText: string,
  subject: string | undefined,
  originalThreadContext?: string,
  preferredModel?: string,
): Promise<ReplyAnalysis> {
  const llm = createLLM({
    model: preferredModel || process.env.LLM_MODEL || "openai/gpt-4o",
    temperature: 0.1,
    maxTokens: 256,
  });
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
    replyTextSource?: "composio_fetch" | "payload_fallback";
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
  options?: { preferredModel?: string },
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

  const messageId = extractMessageIdFromPayload(payload);

  const dateStrings: string[] = [];
  const today = new Date().toISOString().split("T")[0];
  for (let i = 0; i < REPLY_ANALYSIS_DAYS; i++) {
    const d = new Date(today + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    dateStrings.push(d.toISOString().split("T")[0]);
  }

  const { data: rows, error } = await supabase
    .from("todo_items")
    .select("*")
    .eq("user_id", userId)
    .in("date", dateStrings)
    .eq("source_provider", "gmail")
    .neq("status", "done")
    .eq("source_ref->>threadId", threadId);

  if (error || !rows?.length) {
    return {
      processed: 0,
      updated: 0,
      errors: error ? [error.message] : [],
      diagnostics: {
        payloadKeys,
        threadIdSource,
        replyTextLength: 0,
        matchedItems: 0,
        analyses: [],
      },
    };
  }

  const generator = createTodoGenerator(supabase);
  const toProcess: { date: string; item: TodoItem }[] = (rows as unknown[]).map(
    (row) => {
      const r = row as {
        date: string;
        id: string;
        title: string;
        summary: string;
        priority: "normal" | "urgent";
        urgent_reason: string | null;
        status: "open" | "in_progress" | "done";
        due_at: string | null;
        source_provider: string;
        source_type: string;
        source_ref: Record<string, unknown> | null;
        confidence: number;
        tags: string[] | null;
        suggested_next_action: string;
      };
      return {
        date: r.date,
        item: {
          id: r.id,
          title: r.title,
          summary: r.summary,
          priority: r.priority,
          urgentReason: r.urgent_reason ?? undefined,
          status: r.status,
          dueAt: r.due_at,
          sourceProvider: r.source_provider,
          sourceType: r.source_type,
          sourceRef: (r.source_ref ?? {}) as NonNullable<TodoItem["sourceRef"]>,
          confidence: typeof r.confidence === "number" ? r.confidence : 0.8,
          tags: Array.isArray(r.tags) ? r.tags : [],
          suggestedNextAction: r.suggested_next_action,
        },
      };
    },
  );

  console.log(
    `[gmail-reply-resolver] matched ${toProcess.length} task(s) for thread ${threadId}`,
  );

  if (toProcess.length === 0) {
    return {
      processed: 0,
      updated: 0,
      errors: [],
      diagnostics: {
        payloadKeys,
        threadIdSource,
        replyTextLength: 0,
        matchedItems: 0,
        analyses: [],
      },
    };
  }

  let replyText = "";
  let replyTextSource: "composio_fetch" | "payload_fallback" =
    "payload_fallback";

  if (messageId) {
    const fetched = await fetchMessageBodyPlainText(userId, messageId);
    if (fetched) {
      replyText = stripQuotedLines(fetched) || fetched;
      replyTextSource = "composio_fetch";
      console.log(
        `[gmail-reply-resolver] reply from Composio fetch (message_id=${messageId}) length=${replyText.length}`,
      );
    }
  }

  if (!replyText.trim()) {
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
    const bodyData = payload.payload as
      | { body?: { data?: string } }
      | undefined;
    if (typeof bodyData?.body?.data === "string") {
      try {
        const decoded = Buffer.from(bodyData.body.data, "base64").toString(
          "utf-8",
        );
        if (decoded.trim()) parts.push(decoded.trim());
      } catch {
        /* ignore */
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
    const plainText = stripHtmlToPlaintext(rawReplyText);
    replyText =
      stripQuotedLines(plainText) ||
      plainText ||
      stripQuotedLines(rawReplyText) ||
      rawReplyText;
  }

  if (!replyText || !replyText.trim()) {
    return {
      processed: toProcess.length,
      updated: 0,
      errors: [
        "No reply text to analyze (fetch failed and payload had no usable body)",
      ],
      diagnostics: {
        payloadKeys,
        threadIdSource,
        replyTextSource,
        replyTextLength: 0,
        matchedItems: toProcess.length,
        analyses: [],
      },
    };
  }

  console.log(
    `[gmail-reply-resolver] replyText source=${replyTextSource} length=${replyText.length} preview="${replyText.slice(0, 120)}..."`,
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

  for (const { date, item } of toProcess) {
    try {
      const rawAnalysis = await analyzeReplyWithLlm(
        item.title,
        item.summary,
        item.suggestedNextAction ?? item.summary,
        replyText,
        payload.subject,
        originalThreadContext || undefined,
        options?.preferredModel,
      );
      const analysis = normalizeAnalysisAction(rawAnalysis);

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

      await generator.updateItemInSnapshot(userId, date, item.id, patch);
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
      replyTextSource,
      replyTextLength: replyText.length,
      matchedItems: toProcess.length,
      analyses,
    },
  };
}

export { GMAIL_EMAIL_SENT_TRIGGER };
