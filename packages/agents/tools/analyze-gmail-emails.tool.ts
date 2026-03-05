/**
 * Analyze Gmail emails via subagent — fetches FULL data (same as todo-generator)
 * and runs batched analysis to avoid context truncation.
 *
 * Use for: summarize, analyze, "what's important", insights when there are
 * many emails. For simple list/count, use fetch_gmail_emails instead.
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { fetchGmailEmailsFull } from "../lib/composio-gmail";
import { getTaskContext } from "../lib/task-context";
import {
  analyzeEmails,
  type EmailForAnalysis,
} from "@/lib/integrations/email-analysis-agent";

const schema = z.object({
  query: z
    .string()
    .describe(
      "Gmail search query (e.g. 'after:2026/3/1 before:2026/3/2', 'is:unread', 'from:someone@example.com').",
    ),
  analysisFocus: z
    .string()
    .describe(
      "The user's question or focus in their own words—e.g. summarize and highlight what needs action, what's important, key themes.",
    ),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(250)
    .optional()
    .default(100)
    .describe(
      "Max emails to fetch and analyze. Default 100. Use higher for broader queries.",
    ),
  userId: z.string().uuid().optional(),
});

export const analyzeGmailEmailsTool = new DynamicStructuredTool({
  name: "analyze_gmail_emails",
  description:
    "Fetch FULL email content and run subagent analysis for summarize/analyze/insights requests. Use when user asks to summarize many emails, find what's important, or analyze inbox — this avoids truncated snippets. For simple list or count, use fetch_gmail_emails.",
  schema,
  func: async ({ query, analysisFocus, maxResults, userId: argsUserId }) => {
    const contextUserId = getTaskContext()?.userId;
    const userId = argsUserId ?? contextUserId;
    if (!userId) {
      throw new Error("userId is required to analyze Gmail emails");
    }

    const maxPages = Math.min(
      Math.ceil(maxResults / 50),
      50, // GMAIL_FULL_FETCH_MAX_PAGES
    );

    const messages = await fetchGmailEmailsFull(userId, {
      query,
      maxPages,
      pageSize: 50,
      withThreadContext: true,
    });

    const capped = messages.slice(0, maxResults);

    const emailsForAnalysis: EmailForAnalysis[] = capped.map((m) => ({
      subject: m.subject,
      sender: m.sender,
      snippet: m.snippet,
      timestamp: m.timestamp,
      messageId: m.messageId,
      threadId: m.threadId,
      labels: m.labels ?? [],
      threadContext: m.threadContext,
    }));

    const result = await analyzeEmails(emailsForAnalysis, analysisFocus);

    return JSON.stringify({
      analysis: result.analysis,
      emailCount: result.emailCount,
      batchCount: result.batchCount,
      errors: result.errors,
    });
  },
});
