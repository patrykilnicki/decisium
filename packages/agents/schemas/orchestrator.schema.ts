import { z } from "zod";
import { HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

// ═══════════════════════════════════════════════════════════════
// ORCHESTRATOR STATE SCHEMA
// ═══════════════════════════════════════════════════════════════

/**
 * Routing decision for the orchestrator (Composio agent-tools-agent loop).
 */
export type RouteDecision =
  | "tools" // Route to tool execution
  | "saveMessages" // Save conversation to database
  | "end"; // End the workflow

/**
 * Retrieved document with metadata
 */
export interface RetrievedDocument {
  content: string;
  metadata?: {
    type?: string;
    source_id?: string;
    date?: string;
    similarity?: number;
    hierarchy_level?: string;
  };
}

/**
 * Tool call result
 */
export interface ToolCallResult {
  toolName: string;
  toolCallId: string;
  result: string;
  success: boolean;
  error?: string;
}

/**
 * Main orchestrator state interface
 * This is the state object that flows through the LangGraph
 */
export interface OrchestratorState {
  // User context
  userId: string;
  currentDate: string;
  threadId: string;
  userEmail?: string;
  preferredModel?: string;

  // Messages (LangChain format for tool binding)
  messages: BaseMessage[];

  // Original user input
  userMessage?: string;
  originalQuery?: string; // Preserved for rewrite comparison

  // Conversation history (for context)
  conversationHistory?: string;

  // Retrieval state
  retrievedDocs?: RetrievedDocument[];
  retrievedContext?: string; // Formatted context string
  memoryContext?: string; // Legacy compatibility

  // Iteration control
  rewriteCount: number;
  maxRewrites: number;

  // Tool execution state
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    id: string;
  }>;
  toolResults?: ToolCallResult[];
  toolsUsed?: string[];

  // Response state
  agentResponse?: string;
  shouldRespond?: boolean;

  // Message persistence
  userMessageId?: string;
  assistantMessageId?: string;

  // Routing control
  nextRoute?: RouteDecision;
  iterationCount: number;
  maxIterations: number;

  // Connected external services (e.g. "Google Calendar: CONNECTED, Gmail: NOT CONNECTED")
  connectedServices?: string;
}

/**
 * Initial state factory for orchestrator.
 * Builds initial HumanMessage with conversation context (official Composio pattern).
 */
export function createInitialOrchestratorState(input: {
  userId: string;
  threadId: string;
  userMessage: string;
  currentDate?: string;
  userEmail?: string;
  conversationHistory?: string;
  connectedServices?: string;
  preferredModel?: string;
  userMessageId?: string;
}): OrchestratorState {
  const contextParts: string[] = [];
  if (input.conversationHistory) {
    contextParts.push(`Previous conversation:\n${input.conversationHistory}`);
  }
  const contextString =
    contextParts.length > 0 ? contextParts.join("\n\n") + "\n\n" : "";
  const userContent = `${contextString}User: ${input.userMessage}`;

  return {
    userId: input.userId,
    currentDate: input.currentDate || new Date().toISOString().split("T")[0],
    threadId: input.threadId,
    userEmail: input.userEmail,
    preferredModel: input.preferredModel,
    userMessage: input.userMessage,
    originalQuery: input.userMessage,
    conversationHistory: input.conversationHistory,
    messages: [new HumanMessage(userContent)],
    rewriteCount: 0,
    maxRewrites: 2,
    iterationCount: 0,
    maxIterations: 10,
    connectedServices: input.connectedServices,
    userMessageId: input.userMessageId,
  };
}

// ═══════════════════════════════════════════════════════════════
// ZOD SCHEMAS FOR VALIDATION
// ═══════════════════════════════════════════════════════════════

export const RetrievedDocumentSchema = z.object({
  content: z.string(),
  metadata: z
    .object({
      type: z.string().optional(),
      source_id: z.string().optional(),
      date: z.string().optional(),
      similarity: z.number().optional(),
      hierarchy_level: z.string().optional(),
    })
    .optional(),
});

export const ToolCallResultSchema = z.object({
  toolName: z.string(),
  toolCallId: z.string(),
  result: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
});

export const OrchestratorStateSchema = z.object({
  userId: z.string(),
  currentDate: z.string(),
  threadId: z.string(),
  userEmail: z.string().optional(),
  preferredModel: z.string().optional(),
  messages: z.array(z.any()), // BaseMessage is complex, use any
  userMessage: z.string().optional(),
  originalQuery: z.string().optional(),
  conversationHistory: z.string().optional(),
  retrievedDocs: z.array(RetrievedDocumentSchema).optional(),
  retrievedContext: z.string().optional(),
  memoryContext: z.string().optional(),
  rewriteCount: z.number(),
  maxRewrites: z.number(),
  toolCalls: z
    .array(
      z.object({
        name: z.string(),
        args: z.record(z.any()),
        id: z.string(),
      }),
    )
    .optional(),
  toolResults: z.array(ToolCallResultSchema).optional(),
  toolsUsed: z.array(z.string()).optional(),
  agentResponse: z.string().optional(),
  shouldRespond: z.boolean().optional(),
  userMessageId: z.string().optional(),
  assistantMessageId: z.string().optional(),
  nextRoute: z.enum(["tools", "saveMessages", "end"]).optional(),
  iterationCount: z.number(),
  maxIterations: z.number(),
  connectedServices: z.string().optional(),
});

// ═══════════════════════════════════════════════════════════════
// STATE CHANNEL REDUCERS FOR LANGGRAPH
// ═══════════════════════════════════════════════════════════════

/**
 * Channel configuration for LangGraph StateGraph
 * Defines how state updates are merged
 */
export const orchestratorChannels = {
  userId: { reducer: (x: string, y: string) => y ?? x },
  currentDate: { reducer: (x: string, y: string) => y ?? x },
  threadId: { reducer: (x: string, y: string) => y ?? x },
  userEmail: {
    reducer: (x: string | undefined, y: string | undefined) => y ?? x,
  },
  preferredModel: {
    reducer: (x: string | undefined, y: string | undefined) => y ?? x,
  },
  messages: {
    reducer: (x: BaseMessage[], y: BaseMessage[]) => {
      // Append new messages to existing
      if (!y || y.length === 0) return x || [];
      if (!x || x.length === 0) return y;
      return [...x, ...y];
    },
  },
  userMessage: {
    reducer: (x: string | undefined, y: string | undefined) => y ?? x,
  },
  originalQuery: {
    reducer: (x: string | undefined, y: string | undefined) => y ?? x,
  },
  conversationHistory: {
    reducer: (x: string | undefined, y: string | undefined) => y ?? x,
  },
  retrievedDocs: {
    reducer: (
      x: RetrievedDocument[] | undefined,
      y: RetrievedDocument[] | undefined,
    ) => y ?? x,
  },
  retrievedContext: {
    reducer: (x: string | undefined, y: string | undefined) => y ?? x,
  },
  memoryContext: {
    reducer: (x: string | undefined, y: string | undefined) => y ?? x,
  },
  rewriteCount: { reducer: (x: number, y: number) => y ?? x ?? 0 },
  maxRewrites: { reducer: (x: number, y: number) => y ?? x ?? 2 },
  toolCalls: {
    reducer: (
      x: OrchestratorState["toolCalls"],
      y: OrchestratorState["toolCalls"],
    ) => y ?? x,
  },
  toolResults: {
    reducer: (
      x: ToolCallResult[] | undefined,
      y: ToolCallResult[] | undefined,
    ) => {
      // Append new results
      if (!y || y.length === 0) return x || [];
      if (!x || x.length === 0) return y;
      return [...x, ...y];
    },
  },
  toolsUsed: {
    reducer: (x: string[] | undefined, y: string[] | undefined) => {
      // Merge unique tool names
      const existing = new Set(x || []);
      (y || []).forEach((t) => existing.add(t));
      return Array.from(existing);
    },
  },
  agentResponse: {
    reducer: (x: string | undefined, y: string | undefined) => y ?? x,
  },
  shouldRespond: {
    reducer: (x: boolean | undefined, y: boolean | undefined) => y ?? x,
  },
  userMessageId: {
    reducer: (x: string | undefined, y: string | undefined) => y ?? x,
  },
  assistantMessageId: {
    reducer: (x: string | undefined, y: string | undefined) => y ?? x,
  },
  nextRoute: {
    reducer: (x: RouteDecision | undefined, y: RouteDecision | undefined) =>
      y ?? x,
  },
  iterationCount: { reducer: (x: number, y: number) => y ?? x ?? 0 },
  maxIterations: { reducer: (x: number, y: number) => y ?? x ?? 10 },
  connectedServices: {
    reducer: (x: string | undefined, y: string | undefined) => y ?? x,
  },
};

export type OrchestratorChannels = typeof orchestratorChannels;
