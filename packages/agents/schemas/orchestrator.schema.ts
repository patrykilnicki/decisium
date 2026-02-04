import { z } from "zod";
import type { BaseMessage } from "@langchain/core/messages";

// ═══════════════════════════════════════════════════════════════
// ORCHESTRATOR STATE SCHEMA
// ═══════════════════════════════════════════════════════════════

/**
 * Grading result for retrieved documents
 */
export type GradingResult = "relevant" | "irrelevant" | "pending";

/**
 * Routing decision for the orchestrator
 */
export type RouteDecision = 
  | "router"           // Route to router for tool selection
  | "toolExecutor"     // Execute selected tools
  | "gradeDocuments"   // Grade retrieved documents
  | "rewriteQuery"     // Rewrite query for better retrieval
  | "synthesize"       // Generate final response
  | "directResponse"   // Respond without tools
  | "saveMessages"     // Save conversation to database
  | "end";             // End the workflow

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

  // Messages (LangChain format for tool binding)
  messages: BaseMessage[];

  // Original user input
  userMessage?: string;
  originalQuery?: string;  // Preserved for rewrite comparison

  // Conversation history (for context)
  conversationHistory?: string;

  // Retrieval state
  retrievedDocs?: RetrievedDocument[];
  retrievedContext?: string;  // Formatted context string
  memoryContext?: string;     // Legacy compatibility

  // Grading state
  gradingResult?: GradingResult;
  gradingReasoning?: string;

  // Query rewriting state
  rewrittenQuery?: string;
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
}

/**
 * Initial state factory for orchestrator
 */
export function createInitialOrchestratorState(
  input: {
    userId: string;
    threadId: string;
    userMessage: string;
    currentDate?: string;
    userEmail?: string;
    conversationHistory?: string;
  }
): OrchestratorState {
  return {
    userId: input.userId,
    currentDate: input.currentDate || new Date().toISOString().split("T")[0],
    threadId: input.threadId,
    userEmail: input.userEmail,
    userMessage: input.userMessage,
    originalQuery: input.userMessage,
    conversationHistory: input.conversationHistory,
    messages: [],
    rewriteCount: 0,
    maxRewrites: 2,
    iterationCount: 0,
    maxIterations: 5,
  };
}

// ═══════════════════════════════════════════════════════════════
// ZOD SCHEMAS FOR VALIDATION
// ═══════════════════════════════════════════════════════════════

export const RetrievedDocumentSchema = z.object({
  content: z.string(),
  metadata: z.object({
    type: z.string().optional(),
    source_id: z.string().optional(),
    date: z.string().optional(),
    similarity: z.number().optional(),
    hierarchy_level: z.string().optional(),
  }).optional(),
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
  messages: z.array(z.any()), // BaseMessage is complex, use any
  userMessage: z.string().optional(),
  originalQuery: z.string().optional(),
  conversationHistory: z.string().optional(),
  retrievedDocs: z.array(RetrievedDocumentSchema).optional(),
  retrievedContext: z.string().optional(),
  memoryContext: z.string().optional(),
  gradingResult: z.enum(["relevant", "irrelevant", "pending"]).optional(),
  gradingReasoning: z.string().optional(),
  rewrittenQuery: z.string().optional(),
  rewriteCount: z.number(),
  maxRewrites: z.number(),
  toolCalls: z.array(z.object({
    name: z.string(),
    args: z.record(z.any()),
    id: z.string(),
  })).optional(),
  toolResults: z.array(ToolCallResultSchema).optional(),
  toolsUsed: z.array(z.string()).optional(),
  agentResponse: z.string().optional(),
  shouldRespond: z.boolean().optional(),
  userMessageId: z.string().optional(),
  assistantMessageId: z.string().optional(),
  nextRoute: z.enum([
    "router", "toolExecutor", "gradeDocuments", "rewriteQuery",
    "synthesize", "directResponse", "saveMessages", "end"
  ]).optional(),
  iterationCount: z.number(),
  maxIterations: z.number(),
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
  userEmail: { reducer: (x: string | undefined, y: string | undefined) => y ?? x },
  messages: { 
    reducer: (x: BaseMessage[], y: BaseMessage[]) => {
      // Append new messages to existing
      if (!y || y.length === 0) return x || [];
      if (!x || x.length === 0) return y;
      return [...x, ...y];
    }
  },
  userMessage: { reducer: (x: string | undefined, y: string | undefined) => y ?? x },
  originalQuery: { reducer: (x: string | undefined, y: string | undefined) => y ?? x },
  conversationHistory: { reducer: (x: string | undefined, y: string | undefined) => y ?? x },
  retrievedDocs: { 
    reducer: (x: RetrievedDocument[] | undefined, y: RetrievedDocument[] | undefined) => y ?? x 
  },
  retrievedContext: { reducer: (x: string | undefined, y: string | undefined) => y ?? x },
  memoryContext: { reducer: (x: string | undefined, y: string | undefined) => y ?? x },
  gradingResult: { 
    reducer: (x: GradingResult | undefined, y: GradingResult | undefined) => y ?? x 
  },
  gradingReasoning: { reducer: (x: string | undefined, y: string | undefined) => y ?? x },
  rewrittenQuery: { reducer: (x: string | undefined, y: string | undefined) => y ?? x },
  rewriteCount: { reducer: (x: number, y: number) => y ?? x ?? 0 },
  maxRewrites: { reducer: (x: number, y: number) => y ?? x ?? 2 },
  toolCalls: {
    reducer: (x: OrchestratorState["toolCalls"], y: OrchestratorState["toolCalls"]) => y ?? x
  },
  toolResults: { 
    reducer: (x: ToolCallResult[] | undefined, y: ToolCallResult[] | undefined) => {
      // Append new results
      if (!y || y.length === 0) return x || [];
      if (!x || x.length === 0) return y;
      return [...x, ...y];
    }
  },
  toolsUsed: { 
    reducer: (x: string[] | undefined, y: string[] | undefined) => {
      // Merge unique tool names
      const existing = new Set(x || []);
      (y || []).forEach(t => existing.add(t));
      return Array.from(existing);
    }
  },
  agentResponse: { reducer: (x: string | undefined, y: string | undefined) => y ?? x },
  shouldRespond: { reducer: (x: boolean | undefined, y: boolean | undefined) => y ?? x },
  userMessageId: { reducer: (x: string | undefined, y: string | undefined) => y ?? x },
  assistantMessageId: { reducer: (x: string | undefined, y: string | undefined) => y ?? x },
  nextRoute: { 
    reducer: (x: RouteDecision | undefined, y: RouteDecision | undefined) => y ?? x 
  },
  iterationCount: { reducer: (x: number, y: number) => y ?? x ?? 0 },
  maxIterations: { reducer: (x: number, y: number) => y ?? x ?? 5 },
};

export type OrchestratorChannels = typeof orchestratorChannels;
