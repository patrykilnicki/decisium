/**
 * Email Analysis Agent — Batched processing for analyzing many emails.
 *
 * Uses the same pattern as todo-triage-agent: full email data (no truncation like
 * fetch_gmail_emails), batched processing to avoid context truncation. When the user
 * asks to summarize/analyze emails in ASK, this subagent processes them in batches
 * and returns a cohesive analysis.
 */
import { createLLM } from "@/packages/agents/lib/llm";

const BATCH_SIZE = 10;
const MAX_CONCURRENT_BATCHES = 3;

/** Same content limits as todo-generator for consistent analysis quality. */
const EMAIL_SNIPPET_MAX = 300;
const EMAIL_THREAD_CONTEXT_MAX = 900;

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface EmailForAnalysis {
  subject: string;
  sender: string;
  snippet: string;
  timestamp: string;
  messageId: string;
  threadId?: string;
  labels: string[];
  threadContext?: string;
}

function emailsToPromptContext(emails: EmailForAnalysis[]): string {
  return emails
    .map((g) => {
      const snippet = (g.snippet ?? "").trim().slice(0, EMAIL_SNIPPET_MAX);
      const threadContext = (g.threadContext ?? "")
        .trim()
        .slice(0, EMAIL_THREAD_CONTEXT_MAX);
      const hasContent = snippet.length > 0 || threadContext.length > 0;
      const content = hasContent
        ? [snippet, threadContext].filter(Boolean).join("\n\n")
        : "(No snippet or thread context; subject and sender may imply content.)";
      return [
        `[EMAIL] Subject: "${g.subject}" | From: ${g.sender} | Date: ${g.timestamp} | Labels: ${g.labels.join(", ")}`,
        `Content: ${content}`,
      ].join("\n");
    })
    .join("\n\n");
}

const BATCH_ANALYSIS_PROMPT = `You are analyzing a batch of emails for a user. Your job is to produce a concise analysis summary for this batch that answers the user's question.

Read each email's Subject, From, and Content in full. Do not rely on subject lines alone.

Output a clear, structured summary for this batch (3-8 sentences). Focus on:
- Key threads and senders
- Important or actionable items
- Themes and patterns
- Any specific requests or deadlines mentioned

Write in the same language as the emails. Be specific—quote subjects or key phrases when relevant.`;

const SYNTHESIS_PROMPT = `You are synthesizing batch analyses into a single cohesive answer for the user.

The user asked: {{analysisFocus}}

Below are analyses from batches of emails. Combine them into one clear, helpful response.
- Eliminate redundancy
- Maintain chronological or thematic order where useful
- Prioritize what matters most for the user's question
- Be concise but complete—the user should get a full picture
- Write in the same language as the user's question

Output only the final synthesized answer. No meta-commentary like "Here is the summary."`;

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

export interface EmailAnalysisResult {
  analysis: string;
  emailCount: number;
  batchCount: number;
  errors: string[];
}

/**
 * Analyze many emails via batched subagent. Uses full email content (snippet + threadContext)
 * in batches to avoid context truncation — same mechanism as todo-triage for ASK.
 */
export async function analyzeEmails(
  emails: EmailForAnalysis[],
  analysisFocus: string,
): Promise<EmailAnalysisResult> {
  const focus =
    analysisFocus || "Summarize these emails and highlight what's important.";
  const errors: string[] = [];

  if (emails.length === 0) {
    return {
      analysis: "No emails to analyze.",
      emailCount: 0,
      batchCount: 0,
      errors: [],
    };
  }

  const llm = createLLM({ temperature: 0.2, maxTokens: 4096 });
  const totalBatches = Math.ceil(emails.length / BATCH_SIZE);
  const batchedSummaries = new Array<string>(totalBatches);

  // Keep a bounded level of concurrency to reduce latency while avoiding
  // aggressive fan-out that could trigger provider rate limits.
  async function processBatch(batchIndex: number): Promise<void> {
    const start = batchIndex * BATCH_SIZE;
    const batch = emails.slice(start, start + BATCH_SIZE);
    const context = emailsToPromptContext(batch);
    const userContent = `User's question: ${focus}

Analyze these emails and produce a batch summary:

${context}`;

    const messages = [
      { role: "system" as const, content: BATCH_ANALYSIS_PROMPT },
      { role: "user" as const, content: userContent },
    ];

    try {
      const response = await llm.invoke(messages);
      const text =
        typeof response.content === "string"
          ? response.content
          : Array.isArray(response.content)
            ? response.content
                .map((c) =>
                  typeof c === "string"
                    ? c
                    : ((c as { text?: string }).text ?? ""),
                )
                .join("")
            : "";

      batchedSummaries[batchIndex] =
        text.trim() || `[Batch ${batchIndex + 1}: No summary produced]`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[email-analysis] Batch ${batchIndex + 1} failed:`, msg);
      errors.push(`Batch ${batchIndex + 1}: ${msg}`);
      batchedSummaries[batchIndex] =
        `[Batch ${batchIndex + 1}: Analysis failed - ${msg.slice(0, 100)}]`;
    }
  }

  let nextBatchIndex = 0;
  const workerCount = Math.min(MAX_CONCURRENT_BATCHES, totalBatches);

  async function worker(): Promise<void> {
    while (nextBatchIndex < totalBatches) {
      const currentBatchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      await processBatch(currentBatchIndex);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (batchedSummaries.length === 0) {
    return {
      analysis: "No emails could be analyzed.",
      emailCount: emails.length,
      batchCount: 0,
      errors,
    };
  }

  const systemPrompt = SYNTHESIS_PROMPT.replace(
    /\{\{analysisFocus\}\}/g,
    focus,
  );
  const combined = batchedSummaries
    .map((s, idx) => `--- Batch ${idx + 1} ---\n${s}`)
    .join("\n\n");

  try {
    const response = await llm.invoke([
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: `Batch analyses:\n\n${combined}` },
    ]);

    const text =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .map((c) =>
                typeof c === "string"
                  ? c
                  : ((c as { text?: string }).text ?? ""),
              )
              .join("")
          : "";

    const analysis = text.trim() || batchedSummaries.join("\n\n");

    return {
      analysis,
      emailCount: emails.length,
      batchCount: batchedSummaries.length,
      errors,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[email-analysis] Synthesis failed:", msg);
    errors.push(`Synthesis: ${msg}`);
    return {
      analysis: `Analysis could not be completed: ${msg}. Partial summaries:\n\n${batchedSummaries.join("\n\n")}`,
      emailCount: emails.length,
      batchCount: batchedSummaries.length,
      errors,
    };
  }
}
