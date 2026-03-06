/**
 * Shared Gmail-via-Composio layer: account resolution, pagination, parsing, thread enrichment.
 * Used by todo-generation and by the ask flow (e.g. fetch_gmail_emails tool).
 *
 * Depends only on packages/agents/lib/composio.ts.
 */

import {
  isComposioEnabled,
  listComposioConnectedAccounts,
  executeGmailFetchEmails,
  executeGmailFetchThread,
  executeGmailFetchMessageByMessageId,
  executeGmailListLabels,
} from "./composio";

// ─── Constants ─────────────────────────────────────────────────────────────

export const DEFAULT_GMAIL_PAGE_SIZE = 50;
/** Default cap: 10 pages (500 emails). Use GMAIL_FULL_FETCH_MAX_PAGES when all emails from period are needed. */
export const DEFAULT_GMAIL_MAX_PAGES = 10;
/** Max pages when fetching all emails for a period (todo generation, Ask "emails today"). 50 × pageSize = 2500. */
export const GMAIL_FULL_FETCH_MAX_PAGES = 50;
export const THREAD_FETCH_CONCURRENCY = 6;
/** Concurrency for fallback fetch-by-message-id when thread/snippet are empty. */
const MESSAGE_BY_ID_FETCH_CONCURRENCY = 4;

// ─── Types ────────────────────────────────────────────────────────────────

export interface ParsedGmailMessage {
  subject: string;
  sender: string;
  snippet: string;
  timestamp: string;
  messageId: string;
  threadId?: string;
  labels: string[];
  threadContext?: string;
}

// ─── Helpers (internal; used by summarizeThreadPayload and parseGmailMessage) ─

/**
 * Strip HTML tags, base64 blobs, tracking URLs, zero-width characters,
 * and excessive whitespace from email content to produce clean plaintext.
 */
function stripHtmlAndJunk(raw: string): string {
  let out = raw;
  // Remove HTML tags
  out = out.replace(/<[^>]*>/g, " ");
  // Remove HTML entities
  out = out.replace(/&[a-zA-Z0-9#]+;/g, " ");
  // Remove base64 blobs (eyJ..., data:image/..., long hex strings)
  out = out.replace(
    /(?:eyJ[A-Za-z0-9+/=]{40,}|data:[a-z]+\/[a-z]+;base64,[A-Za-z0-9+/=]+)/g,
    "[...]",
  );
  // Remove tracking URLs (very long URLs with utm params / encoded data)
  out = out.replace(/https?:\/\/[^\s]{200,}/g, "[link]");
  // Remove zero-width spaces and invisible Unicode
  out = out.replace(/[\u200B-\u200F\u202A-\u202E\uFEFF\u00AD]+/g, "");
  // Collapse whitespace
  out = out.replace(/\s+/g, " ");
  return out.trim();
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Extract email address from "Name <email>" or return as-is if no angle brackets; normalize to lowercase. */
function normalizeEmailForQuery(addr: string): string {
  const trimmed = addr.trim();
  const match = trimmed.match(/<([^>]+)>/);
  const email = match ? match[1].trim() : trimmed;
  return email.toLowerCase();
}

function buildGmailQueryWithSenders(
  baseQuery: string,
  sendersAccepted?: string[],
  sendersBlocked?: string[],
): string {
  let q = baseQuery.trim();
  const accepted =
    sendersAccepted?.map(normalizeEmailForQuery).filter((e) => e.length > 0) ??
    [];
  const blocked =
    sendersBlocked?.map(normalizeEmailForQuery).filter((e) => e.length > 0) ??
    [];
  if (accepted.length > 0) {
    const fromClause =
      accepted.length === 1
        ? `from:${accepted[0]}`
        : `(${accepted.map((e) => `from:${e}`).join(" OR ")})`;
    q = q ? `${q} ${fromClause}` : fromClause;
  }
  if (blocked.length > 0) {
    const exclude = blocked.map((e) => `-from:${e}`).join(" ");
    q = q ? `${q} ${exclude}` : exclude;
  }
  return q;
}

function extractMessagesFromPayload(value: unknown): unknown[] | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const candidates = [
    obj.messages,
    (obj.thread as Record<string, unknown> | undefined)?.messages,
    (obj.data as Record<string, unknown> | undefined)?.messages,
    obj.history,
    (obj.payload as Record<string, unknown> | undefined)?.parts,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c;
  }
  if (Array.isArray(obj)) return obj;
  return null;
}

/** End of target day in UTC (ms). Used to filter thread messages to "on or before this day". */
function endOfDayUtcMs(yyyyMmDd: string): number {
  const d = new Date(yyyyMmDd + "T23:59:59.999Z");
  return d.getTime();
}

/**
 * Extract message timestamp (ms since epoch) from a raw message object.
 * Gmail API uses internalDate (string ms); Composio may expose messageTimestamp (ISO or ms).
 */
function getMessageTimestamp(row: Record<string, unknown>): number | null {
  const internalDate = row.internalDate ?? row.internal_date;
  if (internalDate != null) {
    const ms =
      typeof internalDate === "string"
        ? parseInt(internalDate, 10)
        : Number(internalDate);
    if (Number.isFinite(ms)) return ms;
  }
  const ts = row.messageTimestamp ?? row.date ?? row.timestamp;
  if (ts == null) return null;
  if (typeof ts === "number" && Number.isFinite(ts))
    return ts <= 1e12 ? ts * 1000 : ts;
  const str = String(ts).trim();
  const parsed = Date.parse(str);
  return Number.isNaN(parsed) ? null : parsed;
}

export interface SummarizeThreadOptions {
  /** When set, only messages on or before this date (YYYY-MM-DD) are included in context. Used for todo generation so context is 01.02–06.02 when generating for 06.02. */
  targetDateYyyyMmDd?: string;
}

function summarizeThreadPayload(
  payload: Record<string, unknown>,
  options?: SummarizeThreadOptions,
): string {
  let list = extractMessagesFromPayload(payload);
  if (!list) {
    const data = payload.data ?? payload.output ?? payload.result;
    list = extractMessagesFromPayload(data);
  }
  if (!Array.isArray(list) || list.length === 0) return "";

  let messagesToSummarize: unknown[];
  if (options?.targetDateYyyyMmDd) {
    const cutoffMs = endOfDayUtcMs(options.targetDateYyyyMmDd);
    const withTs = list
      .filter(
        (m): m is Record<string, unknown> => m != null && typeof m === "object",
      )
      .map((m) => ({ msg: m, ts: getMessageTimestamp(m) ?? 0 }))
      .sort((a, b) => a.ts - b.ts);
    const onOrBefore = withTs
      .filter(({ ts }) => ts <= cutoffMs)
      .map(({ msg }) => msg);
    messagesToSummarize = onOrBefore.slice(-6);
  } else {
    messagesToSummarize = list.slice(-6);
  }

  const snippets: string[] = [];
  for (const message of messagesToSummarize) {
    if (message == null || typeof message !== "object") continue;
    const row = message as Record<string, unknown>;
    const from =
      toNonEmptyString(row.sender) ??
      toNonEmptyString(row.from) ??
      toNonEmptyString(row.author) ??
      (() => {
        const p = row.payload as
          | { headers?: Array<{ name?: string; value?: string }> }
          | undefined;
        const fromHeader = p?.headers?.find((h) => h.name === "From");
        return toNonEmptyString(fromHeader?.value);
      })() ??
      "Unknown sender";
    const rawBody =
      toNonEmptyString(row.snippet) ??
      toNonEmptyString(row.messageText) ??
      toNonEmptyString(row.body) ??
      toNonEmptyString(row.textPlain) ??
      toNonEmptyString(row.text) ??
      "";
    if (!rawBody) continue;
    const cleanBody = stripHtmlAndJunk(rawBody);
    if (!cleanBody) continue;
    snippets.push(`${from}: ${cleanBody.slice(0, 1000)}`);
  }
  return snippets.join(" || ").slice(0, 6000);
}

/** Extract plaintext body from GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID response. */
function extractBodyFromMessagePayload(
  payload: Record<string, unknown>,
): string {
  const preview = payload.data_preview as Record<string, unknown> | undefined;
  const raw =
    toNonEmptyString(payload.messageText) ??
    toNonEmptyString(preview?.messageText) ??
    toNonEmptyString(payload.body) ??
    toNonEmptyString(payload.textPlain) ??
    toNonEmptyString(payload.text) ??
    toNonEmptyString(payload.snippet) ??
    (() => {
      const data = payload.data ?? payload.response;
      if (data && typeof data === "object") {
        return extractBodyFromMessagePayload(data as Record<string, unknown>);
      }
      const results = payload.results as
        | Array<Record<string, unknown>>
        | undefined;
      const first = results?.[0]?.response ?? results?.[0];
      if (first && typeof first === "object") {
        return extractBodyFromMessagePayload(first as Record<string, unknown>);
      }
      return "";
    })();
  return raw ? stripHtmlAndJunk(raw) : "";
}

/**
 * For messages with no snippet and no threadContext: first try
 * GMAIL_FETCH_MESSAGE_BY_THREAD_ID per thread, then GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID for any still missing.
 */
async function enrichMessagesWithMessageBodyFallback(
  userId: string,
  connectedAccountId: string,
  messages: ParsedGmailMessage[],
  options?: { targetDateYyyyMmDd?: string },
): Promise<ParsedGmailMessage[]> {
  const needFallback = messages.filter(
    (m) =>
      m.messageId &&
      !(m.snippet ?? "").trim() &&
      !(m.threadContext ?? "").trim(),
  );
  if (needFallback.length === 0) return messages;

  const threadContextByThreadId = new Map<string, string>();
  const threadIds = [
    ...new Set(
      needFallback
        .map((m) => m.threadId)
        .filter((id): id is string => Boolean(id?.trim())),
    ),
  ];
  const summarizeOpts: SummarizeThreadOptions | undefined =
    options?.targetDateYyyyMmDd
      ? { targetDateYyyyMmDd: options.targetDateYyyyMmDd }
      : undefined;

  await mapConcurrent(threadIds, THREAD_FETCH_CONCURRENCY, async (threadId) => {
    const res = await executeGmailFetchThread(userId, connectedAccountId, {
      threadId,
    }).catch(() => null);
    if (!res?.successful || !res.data) return;
    const summary = summarizeThreadPayload(res.data, summarizeOpts);
    if (summary) threadContextByThreadId.set(threadId, summary);
  });

  const enriched = messages.map((msg) => {
    if (!msg.threadId) return msg;
    const threadContext = threadContextByThreadId.get(msg.threadId);
    if (!threadContext) return msg;
    return {
      ...msg,
      snippet: threadContext.slice(0, 2000),
      threadContext: threadContext.slice(0, 6000),
    };
  });

  const stillNeedFallback = enriched.filter(
    (m) =>
      m.messageId &&
      !(m.snippet ?? "").trim() &&
      !(m.threadContext ?? "").trim(),
  );
  if (stillNeedFallback.length === 0) return enriched;

  const bodyByMessageId = new Map<string, string>();
  await mapConcurrent(
    stillNeedFallback,
    MESSAGE_BY_ID_FETCH_CONCURRENCY,
    async (msg) => {
      const res = await executeGmailFetchMessageByMessageId(
        userId,
        connectedAccountId,
        { messageId: msg.messageId },
      ).catch(() => null);
      if (!res?.successful || !res.data) return;
      const body = extractBodyFromMessagePayload(res.data);
      if (body) bodyByMessageId.set(msg.messageId, body);
    },
  );

  return enriched.map((msg) => {
    const body = bodyByMessageId.get(msg.messageId);
    if (!body) return msg;
    return {
      ...msg,
      snippet: body.slice(0, 2000),
      threadContext: body.slice(0, 6000),
    };
  });
}

/**
 * Fetch a single Gmail thread by ID and return parsed messages with thread context.
 * Used by todo merge when webhook delivers one new email: we only fetch that thread
 * instead of all emails for the day.
 */
export async function fetchGmailMessagesForThread(
  userId: string,
  threadId: string,
  options?: { targetDateYyyyMmDd?: string },
): Promise<ParsedGmailMessage[]> {
  if (!isComposioEnabled() || !threadId?.trim()) return [];
  const connectedAccountId = await getGmailConnectedAccountId(userId);
  if (!connectedAccountId) return [];

  const res = await executeGmailFetchThread(userId, connectedAccountId, {
    threadId: threadId.trim(),
  }).catch(() => null);
  if (!res?.successful || !res.data) return [];

  let list = extractMessagesFromPayload(res.data);
  if (!list) {
    const data = (res.data as Record<string, unknown>).data ?? res.data;
    list = extractMessagesFromPayload(data);
  }
  if (!Array.isArray(list) || list.length === 0) return [];

  const summarizeOpts: SummarizeThreadOptions | undefined =
    options?.targetDateYyyyMmDd
      ? { targetDateYyyyMmDd: options.targetDateYyyyMmDd }
      : undefined;
  const threadContext = summarizeThreadPayload(
    res.data as Record<string, unknown>,
    summarizeOpts,
  );

  const cutoffMs = options?.targetDateYyyyMmDd
    ? endOfDayUtcMs(options.targetDateYyyyMmDd)
    : null;

  const parsed: ParsedGmailMessage[] = [];
  const rawList = list.filter(
    (m): m is Record<string, unknown> => m != null && typeof m === "object",
  );
  const withTs = rawList
    .map((m) => ({ msg: m, ts: getMessageTimestamp(m) ?? 0 }))
    .sort((a, b) => a.ts - b.ts);
  const toUse =
    cutoffMs != null ? withTs.filter(({ ts }) => ts <= cutoffMs) : withTs;

  for (const { msg } of toUse) {
    const normalized = {
      ...msg,
      messageId:
        (msg as Record<string, unknown>).messageId ??
        (msg as Record<string, unknown>).id ??
        "",
      thread_id: threadId,
      threadId,
    };
    const p = parseGmailMessage(normalized as Record<string, unknown>);
    parsed.push({
      ...p,
      threadId: threadId,
      threadContext: threadContext.slice(0, 6000),
      snippet: (p.snippet ?? "").trim() || threadContext.slice(0, 2000),
    });
  }
  return parsed;
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

// ─── Account resolution ────────────────────────────────────────────────────

/**
 * Get the first active Gmail connected account ID for a user.
 */
export async function getGmailConnectedAccountId(
  userId: string,
): Promise<string | null> {
  if (!isComposioEnabled()) return null;
  const accounts = await listComposioConnectedAccounts(userId, "GMAIL");
  return accounts[0]?.id ?? null;
}

// ─── Single message body (for reply resolver) ───────────────────────────────

/**
 * Extract plain text from a GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID response.
 * Prefers text/plain from payload.parts when present (Gmail API structure).
 */
function getMessageBodyFromFetchResult(data: Record<string, unknown>): string {
  const parts = data.parts ?? (data.payload as Record<string, unknown>)?.parts;
  if (Array.isArray(parts) && parts.length > 0) {
    let plain: string | undefined;
    let html: string | undefined;
    for (const p of parts) {
      if (p == null || typeof p !== "object") continue;
      const part = p as Record<string, unknown>;
      const body = part.body as { data?: string } | undefined;
      const b64 = body?.data;
      if (typeof b64 !== "string" || !b64.trim()) continue;
      const mimeType = String(
        part.mimeType ?? part.mime_type ?? "",
      ).toLowerCase();
      try {
        const decoded = Buffer.from(b64, "base64").toString("utf-8").trim();
        if (!decoded) continue;
        if (mimeType === "text/plain") plain = decoded;
        else if (mimeType === "text/html") html = decoded;
      } catch {
        /* ignore */
      }
    }
    if (plain) return plain;
    if (html) return stripHtmlAndJunk(html);
  }
  return extractBodyFromMessagePayload(data);
}

/**
 * Fetch a single message by ID via Composio and return its body as plain text.
 * Used when resolving Gmail reply: we only fetch the message when we already
 * know there is a matching task, so we get a single source of truth (same API
 * as todo generation) instead of relying on webhook payload body shape.
 */
export async function fetchMessageBodyPlainText(
  userId: string,
  messageId: string,
): Promise<string> {
  if (!isComposioEnabled() || !messageId?.trim()) return "";
  const connectedAccountId = await getGmailConnectedAccountId(userId);
  if (!connectedAccountId) return "";
  const res = await executeGmailFetchMessageByMessageId(
    userId,
    connectedAccountId,
    { messageId: messageId.trim() },
  ).catch(() => null);
  if (!res || !res.successful || !res.data) return "";
  return getMessageBodyFromFetchResult(res.data).slice(0, 4000).trim();
}

/**
 * List Gmail labels for the authenticated user (for todo scope settings UI).
 * Returns [] when Composio is disabled or user has no Gmail connection.
 */
export async function listGmailLabels(
  userId: string,
): Promise<Array<{ id: string; name: string }>> {
  if (!isComposioEnabled()) return [];
  const connectedAccountId = await getGmailConnectedAccountId(userId);
  if (!connectedAccountId) return [];
  const result = await executeGmailListLabels(userId, connectedAccountId);
  return result.data?.labels ?? [];
}

// ─── Pagination ─────────────────────────────────────────────────────────────

export interface FetchGmailEmailsPaginatedOptions {
  query: string;
  pageSize?: number;
  maxPages?: number;
  /** Only messages that have at least one of these label IDs (Gmail API label_ids). */
  labelIdsAccepted?: string[];
}

export interface FetchGmailEmailsPaginatedResult {
  messages: Array<Record<string, unknown>>;
  connectedAccountId: string;
}

/**
 * Fetch all pages of Gmail messages for a query (server-side pagination).
 */
export async function fetchGmailEmailsPaginated(
  userId: string,
  connectedAccountId: string,
  options: FetchGmailEmailsPaginatedOptions,
): Promise<FetchGmailEmailsPaginatedResult> {
  const pageSize = options.pageSize ?? DEFAULT_GMAIL_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_GMAIL_MAX_PAGES;
  const allMessages: Array<Record<string, unknown>> = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const result = await executeGmailFetchEmails(userId, connectedAccountId, {
      query: options.query,
      max_results: pageSize,
      page_token: pageToken,
      label_ids: options.labelIdsAccepted?.length
        ? options.labelIdsAccepted
        : undefined,
    });

    if (!result.successful || !result.data?.messages) break;

    for (const msg of result.data.messages) {
      allMessages.push(msg as Record<string, unknown>);
    }

    pageToken = result.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  return { messages: allMessages, connectedAccountId };
}

// ─── Parsing ────────────────────────────────────────────────────────────────

/**
 * Parse a raw Composio Gmail message object into a normalized shape.
 */
export function parseGmailMessage(
  msg: Record<string, unknown>,
): ParsedGmailMessage {
  const rawSnippet = String(msg.snippet ?? msg.messageText ?? "");
  return {
    subject: String(msg.subject ?? ""),
    sender: String(msg.sender ?? ""),
    snippet: rawSnippet.slice(0, 300),
    timestamp: String(msg.messageTimestamp ?? ""),
    messageId: String(msg.messageId ?? ""),
    threadId: toNonEmptyString(msg.threadId) ?? toNonEmptyString(msg.thread_id),
    labels: Array.isArray(msg.labelIds) ? (msg.labelIds as string[]) : [],
  };
}

// ─── Thread enrichment ──────────────────────────────────────────────────────

export interface EnrichThreadContextOptions {
  /** When set, thread context includes only messages on or before this date (YYYY-MM-DD). E.g. for todo date 06.02, context is 01.02–06.02. */
  targetDateYyyyMmDd?: string;
}

/**
 * Enrich parsed messages with thread context (summary of each thread).
 * When targetDateYyyyMmDd is set (e.g. todo generation for 06.02), only messages up to that date are included in the summary.
 */
export async function enrichGmailMessagesWithThreadContext(
  userId: string,
  connectedAccountId: string,
  messages: ParsedGmailMessage[],
  options?: EnrichThreadContextOptions,
): Promise<ParsedGmailMessage[]> {
  const threadIds = [
    ...new Set(messages.map((m) => m.threadId).filter(Boolean)),
  ] as string[];
  if (threadIds.length === 0) return messages;

  const threadMap = new Map<string, string>();
  const summarizeOpts: SummarizeThreadOptions | undefined =
    options?.targetDateYyyyMmDd
      ? { targetDateYyyyMmDd: options.targetDateYyyyMmDd }
      : undefined;

  await mapConcurrent(threadIds, THREAD_FETCH_CONCURRENCY, async (threadId) => {
    const response = await executeGmailFetchThread(userId, connectedAccountId, {
      threadId,
    }).catch(() => null);
    if (!response?.successful || !response.data) return;

    const summary = summarizeThreadPayload(response.data, summarizeOpts);
    if (summary) threadMap.set(threadId, summary);
  });

  if (threadMap.size === 0) return messages;
  return messages.map((msg) => {
    if (!msg.threadId) return msg;
    const threadContext = threadMap.get(msg.threadId);
    return threadContext ? { ...msg, threadContext } : msg;
  });
}

// ─── All-in-one fetch ───────────────────────────────────────────────────────

export interface FetchGmailEmailsFullOptions {
  query: string;
  maxPages?: number;
  pageSize?: number;
  withThreadContext?: boolean;
  /** When set with withThreadContext, thread context is limited to messages on or before this date (YYYY-MM-DD). Used by todo generation. */
  targetDate?: string;
  /** Only messages with at least one of these label IDs. */
  labelIdsAccepted?: string[];
  /** After fetch, exclude messages that have any of these label IDs (filtered in-app). */
  labelIdsBlocked?: string[];
  /** Only messages from these senders (email addresses). Appended to query as (from:a OR from:b). */
  sendersAccepted?: string[];
  /** Exclude messages from these senders. Appended to query as -from:a -from:b. */
  sendersBlocked?: string[];
}

/**
 * Fetch all matching Gmail messages for a user: resolve account, paginate, parse,
 * and optionally enrich with thread context. Returns [] when Composio is disabled
 * or user has no Gmail connection.
 */
export async function fetchGmailEmailsFull(
  userId: string,
  options: FetchGmailEmailsFullOptions,
): Promise<ParsedGmailMessage[]> {
  if (!isComposioEnabled()) return [];

  const connectedAccountId = await getGmailConnectedAccountId(userId);
  if (!connectedAccountId) return [];

  const pageSize = options.pageSize ?? DEFAULT_GMAIL_PAGE_SIZE;
  const maxPages =
    options.maxPages ??
    (options.withThreadContext
      ? GMAIL_FULL_FETCH_MAX_PAGES
      : DEFAULT_GMAIL_MAX_PAGES);

  const query = buildGmailQueryWithSenders(
    options.query,
    options.sendersAccepted,
    options.sendersBlocked,
  );

  const { messages: rawMessages, connectedAccountId: accountId } =
    await fetchGmailEmailsPaginated(userId, connectedAccountId, {
      query,
      pageSize,
      maxPages,
      labelIdsAccepted: options.labelIdsAccepted?.length
        ? options.labelIdsAccepted
        : undefined,
    });

  let parsed = rawMessages.map(parseGmailMessage);

  if (options.labelIdsBlocked?.length) {
    const blockedSet = new Set(options.labelIdsBlocked);
    parsed = parsed.filter((msg) => !msg.labels.some((l) => blockedSet.has(l)));
  }

  if (parsed.length === 0) return [];

  if (options.withThreadContext) {
    const threadOpts = options.targetDate
      ? { targetDateYyyyMmDd: options.targetDate }
      : undefined;
    const withThread = await enrichGmailMessagesWithThreadContext(
      userId,
      accountId,
      parsed,
      threadOpts,
    );
    return enrichMessagesWithMessageBodyFallback(
      userId,
      accountId,
      withThread,
      {
        targetDateYyyyMmDd: options.targetDate,
      },
    );
  }
  return parsed;
}
