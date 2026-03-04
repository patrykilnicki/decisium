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
} from "./composio";

// ─── Constants ─────────────────────────────────────────────────────────────

export const DEFAULT_GMAIL_PAGE_SIZE = 50;
export const DEFAULT_GMAIL_MAX_PAGES = 10;
export const THREAD_FETCH_CONCURRENCY = 6;

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

function summarizeThreadPayload(payload: Record<string, unknown>): string {
  let list = extractMessagesFromPayload(payload);
  if (!list) {
    const data = payload.data ?? payload.output ?? payload.result;
    list = extractMessagesFromPayload(data);
  }
  if (!Array.isArray(list) || list.length === 0) return "";

  const snippets: string[] = [];
  const lastMessages = list.slice(-4);
  for (const message of lastMessages) {
    if (!message || typeof message !== "object") continue;
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
    snippets.push(`${from}: ${cleanBody.slice(0, 180)}`);
  }
  return snippets.join(" || ").slice(0, 900);
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

// ─── Pagination ─────────────────────────────────────────────────────────────

export interface FetchGmailEmailsPaginatedOptions {
  query: string;
  pageSize?: number;
  maxPages?: number;
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
    snippet: stripHtmlAndJunk(rawSnippet).slice(0, 300),
    timestamp: String(msg.messageTimestamp ?? ""),
    messageId: String(msg.messageId ?? ""),
    threadId: toNonEmptyString(msg.threadId) ?? toNonEmptyString(msg.thread_id),
    labels: Array.isArray(msg.labelIds) ? (msg.labelIds as string[]) : [],
  };
}

// ─── Thread enrichment ──────────────────────────────────────────────────────

/**
 * Enrich parsed messages with thread context (summary of each thread).
 */
export async function enrichGmailMessagesWithThreadContext(
  userId: string,
  connectedAccountId: string,
  messages: ParsedGmailMessage[],
): Promise<ParsedGmailMessage[]> {
  const threadIds = [
    ...new Set(messages.map((m) => m.threadId).filter(Boolean)),
  ] as string[];
  if (threadIds.length === 0) return messages;

  const threadMap = new Map<string, string>();

  await mapConcurrent(threadIds, THREAD_FETCH_CONCURRENCY, async (threadId) => {
    const response = await executeGmailFetchThread(userId, connectedAccountId, {
      threadId,
    }).catch(() => null);
    if (!response?.successful || !response.data) return;

    const summary = summarizeThreadPayload(response.data);
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

  const { messages: rawMessages, connectedAccountId: accountId } =
    await fetchGmailEmailsPaginated(userId, connectedAccountId, {
      query: options.query,
      pageSize: options.pageSize ?? DEFAULT_GMAIL_PAGE_SIZE,
      maxPages: options.maxPages ?? DEFAULT_GMAIL_MAX_PAGES,
    });

  const parsed = rawMessages.map(parseGmailMessage);
  if (parsed.length === 0) return [];

  if (options.withThreadContext) {
    return enrichGmailMessagesWithThreadContext(userId, accountId, parsed);
  }
  return parsed;
}
