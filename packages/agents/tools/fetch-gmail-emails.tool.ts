import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { fetchGmailEmailsFull } from "../lib/composio-gmail";
import { getTaskContext } from "../lib/task-context";

const schema = z.object({
  query: z
    .string()
    .describe(
      "Gmail search query (e.g. 'after:2026/3/1 before:2026/3/2', 'is:unread', 'from:someone@example.com'). Use for listing, summarizing, or counting emails.",
    ),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe(
      "Optional cap on total messages to fetch (across all pages). Omit to fetch all pages up to internal limit.",
    ),
  withThreadContext: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "When true, include message/thread content for each email so you can review and summarize accurately. Set true for list/summarize/count requests.",
    ),
  userId: z.string().uuid().optional().describe("Authenticated user id"),
});

/**
 * Fetch Gmail messages for a user with server-side pagination.
 * Use this for "list emails", "emails today", "summarize my inbox" — one call returns
 * all matching messages (no need for the agent to paginate with page_token).
 */
export const fetchGmailEmailsTool = new DynamicStructuredTool({
  name: "fetch_gmail_emails",
  description:
    "Fetch the user's Gmail messages matching a search query. Handles pagination automatically—use this for listing, summarizing, or counting emails (e.g. 'emails today', 'important emails', 'from X'). Pass a Gmail-style query (e.g. after:YYYY/MM/DD, is:unread). For sending or drafting emails use Composio tools (GMAIL_SEND_EMAIL, etc.).",
  schema,
  func: async ({
    query,
    maxResults,
    withThreadContext,
    userId: argsUserId,
  }) => {
    const contextUserId = getTaskContext()?.userId;
    const userId = argsUserId ?? contextUserId;
    if (!userId) {
      throw new Error("userId is required to fetch Gmail emails");
    }

    const maxPages = maxResults ? Math.ceil(maxResults / 50) : undefined;

    const messages = await fetchGmailEmailsFull(userId, {
      query,
      maxPages,
      withThreadContext,
    });

    const capped = maxResults ? messages.slice(0, maxResults) : messages;

    return JSON.stringify({
      messages: capped.map((m) => ({
        subject: m.subject,
        sender: m.sender,
        snippet: m.snippet.slice(0, 300),
        timestamp: m.timestamp,
        messageId: m.messageId,
        threadId: m.threadId,
        labels: m.labels,
        ...(m.threadContext && {
          threadContext: m.threadContext.slice(0, 900),
        }),
      })),
      count: capped.length,
    });
  },
});
