import { z } from "zod";

// ═══════════════════════════════════════════════════════════════
// PAGE CONTEXT
// ═══════════════════════════════════════════════════════════════

/**
 * Page types in the application
 */
export const PageTypeSchema = z.enum(["daily", "ask"]);
export type PageType = z.infer<typeof PageTypeSchema>;

/**
 * Context passed from the API layer to the main agent
 */
export interface MainAgentContext {
  /** Which page the user is interacting from */
  page: PageType;
  /** Authenticated user ID */
  userId: string;
  /** Current date in YYYY-MM-DD format */
  currentDate: string;
  /** User's email address (optional) */
  userEmail?: string;
  /** Thread ID for ask conversations (optional) */
  threadId?: string;
  /** Conversation history for ask threads (optional) */
  conversationHistory?: string;
  /** Date for daily events (optional, defaults to currentDate) */
  date?: string;
}

// ═══════════════════════════════════════════════════════════════
// MAIN AGENT INPUT
// ═══════════════════════════════════════════════════════════════

/**
 * Input to the main agent
 */
export interface MainAgentInput {
  /** The user's message */
  userMessage: string;
  /** Context about where the request came from */
  context: MainAgentContext;
}

// ═══════════════════════════════════════════════════════════════
// MAIN AGENT RESULT
// ═══════════════════════════════════════════════════════════════

/**
 * Result from the main agent
 */
export interface MainAgentResult {
  /** The agent's response to the user */
  agentResponse: string;
  /** Which subagent handled the request (if delegated) */
  handledBy?: "main" | "daily-agent" | "ask-agent";
  /** ID of the saved user message (if applicable) */
  userMessageId?: string;
  /** ID of the saved assistant message (if applicable) */
  assistantMessageId?: string;
  /** Tools that were used during processing */
  toolsUsed?: string[];
}

// Note: Daily and Ask specific types are imported from their respective schemas
// See: ./daily.schema.ts and ./ask.schema.ts

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Create initial context for daily page requests
 */
export function createDailyContext(params: {
  userId: string;
  currentDate?: string;
  userEmail?: string;
}): MainAgentContext {
  const currentDate = params.currentDate || new Date().toISOString().split("T")[0];
  return {
    page: "daily",
    userId: params.userId,
    currentDate,
    date: currentDate,
    userEmail: params.userEmail,
  };
}

/**
 * Create initial context for ask page requests
 */
export function createAskContext(params: {
  userId: string;
  threadId: string;
  currentDate?: string;
  userEmail?: string;
  conversationHistory?: string;
}): MainAgentContext {
  return {
    page: "ask",
    userId: params.userId,
    threadId: params.threadId,
    currentDate: params.currentDate || new Date().toISOString().split("T")[0],
    userEmail: params.userEmail,
    conversationHistory: params.conversationHistory,
  };
}

/**
 * Format context for inclusion in agent prompts
 */
export function formatContextForPrompt(context: MainAgentContext): string {
  const parts: string[] = [
    `Page: ${context.page}`,
    `User ID: ${context.userId}`,
    `Date: ${context.currentDate}`,
  ];

  if (context.threadId) {
    parts.push(`Thread ID: ${context.threadId}`);
  }

  if (context.conversationHistory) {
    parts.push(`\nConversation History:\n${context.conversationHistory}`);
  }

  return parts.join("\n");
}
