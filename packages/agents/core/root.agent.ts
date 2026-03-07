import { StateGraph, END, START } from "@langchain/langgraph";
import { createBaseAgent } from "../lib/agent-base";
import { supabaseStoreTool } from "../tools";
import { buildAgentContext } from "../lib/context";
import { handleAgentError } from "../lib/error-handler";
import { logLlmUsage } from "../lib/llm-usage";
import { logPromptPayload } from "../lib/prompt-logs";
import { storeMemory } from "@/lib/memory/memory-service";
import {
  createOrchestratorGraph,
  processOrchestratorMessage,
} from "./orchestrator.agent";
import { ROOT_AGENT_SYSTEM_PROMPT } from "../prompts";

// ═══════════════════════════════════════════════════════════════
// FEATURE FLAGS
// ═══════════════════════════════════════════════════════════════

/**
 * Agent mode configuration
 * - "linear": Original linear flow (deterministic retrieval)
 * - "agentic": New agentic flow with autonomous tool selection
 */
export type AgentMode = "linear" | "agentic";

/**
 * Get the current agent mode from environment or default
 */
export function getAgentMode(): AgentMode {
  const mode = process.env.AGENT_MODE as AgentMode;
  return mode === "agentic" ? "agentic" : "linear";
}

/**
 * Check if agentic mode is enabled
 */
export function isAgenticModeEnabled(): boolean {
  return getAgentMode() === "agentic";
}

// Type Definitions

export interface RootGraphState {
  userId: string;
  currentDate: string;
  threadId: string;
  userMessage?: string;
  conversationHistory?: string;
  memoryContext?: string;
  agentResponse?: string;
  userEmail?: string;
  preferredModel?: string;
  userMessageId?: string;
  assistantMessageId?: string;
}

export interface RootMessageResult {
  agentResponse: string;
  userMessageId?: string;
  assistantMessageId?: string;
}

async function storeAskEmbedding(params: {
  userId: string;
  threadId: string;
  content: string;
  sourceId: string;
  currentDate: string;
}): Promise<void> {
  try {
    await storeMemory({
      userId: params.userId,
      content: params.content,
      memoryType: "conversation",
      source: "agent",
      sourceId: params.sourceId,
      ttl: "7 days",
      metadata: {
        type: "ask_message",
        thread_id: params.threadId,
        date: params.currentDate,
      },
    });
  } catch (embeddingError) {
    console.error("Error storing embedding for ask message:", embeddingError);
  }
}

// Node Implementations

/** No-op: memory now comes from Composio (calendar, etc.), not database */
async function memoryRetrieverNode(
  _state: RootGraphState,
): Promise<Partial<RootGraphState>> {
  return { memoryContext: "" };
}

async function rootResponseAgentNode(
  state: RootGraphState,
): Promise<Partial<RootGraphState>> {
  if (!state.userMessage) {
    return {};
  }

  const responseAgent = createBaseAgent({
    systemPrompt: ROOT_AGENT_SYSTEM_PROMPT,
    agentType: "root",
    currentDate: state.currentDate,
    model: state.preferredModel,
  }) as RootAgentInvokable;

  // Build conversation history including the new user message
  const fullConversationHistory = state.conversationHistory
    ? `${state.conversationHistory}\n\nUser: ${state.userMessage}`
    : `User: ${state.userMessage}`;

  // Build context for the agent
  const context = buildAgentContext({
    userId: state.userId,
    currentDate: state.currentDate,
    conversationHistory: fullConversationHistory,
    memoryContext: state.memoryContext,
    userEmail: state.userEmail,
  });

  // Use the context as the prompt (it already includes the conversation history with the new message)
  const prompt = context || `User: ${state.userMessage}`;
  const systemPrompt = ROOT_AGENT_SYSTEM_PROMPT.replace(
    /{{currentDate}}/g,
    state.currentDate,
  );

  await logPromptPayload({
    userId: state.userId,
    agentType: "root_response_agent",
    nodeKey: "root_response_agent",
    taskType: "root.response_agent",
    model: state.preferredModel || process.env.LLM_MODEL || "openai/gpt-4o",
    temperature: 0.7,
    systemPrompt,
    messages: [{ role: "user", content: prompt }],
  });

  const result = await responseAgent.invoke({
    messages: [{ role: "user", content: prompt }],
  });
  await logLlmUsage({
    response: result,
    userId: state.userId,
    agentType: "root_response_agent",
    nodeKey: "root_response_agent",
    taskType: "root.response_agent",
  });

  // Extract response content, handling both string and array types
  const lastMessage = result.messages?.[result.messages.length - 1];
  let agentResponse = "";

  if (lastMessage?.content) {
    if (typeof lastMessage.content === "string") {
      agentResponse = lastMessage.content;
    } else if (Array.isArray(lastMessage.content)) {
      // Handle array of content blocks (extract text from each)
      agentResponse = lastMessage.content
        .map((block: { text?: string } | string) =>
          typeof block === "string" ? block : block?.text || "",
        )
        .join("");
    }
  }

  return { agentResponse };
}

async function saveUserMessageNode(
  state: RootGraphState,
): Promise<Partial<RootGraphState>> {
  if (!state.userMessage || !state.threadId) {
    return {};
  }

  try {
    if (state.userMessageId) {
      await storeAskEmbedding({
        userId: state.userId,
        threadId: state.threadId,
        content: state.userMessage,
        sourceId: state.userMessageId,
        currentDate: state.currentDate,
      });
      return { userMessageId: state.userMessageId };
    }

    const savedMessageStr = await supabaseStoreTool.invoke({
      table: "ask_messages",
      data: {
        thread_id: state.threadId,
        role: "user",
        content: state.userMessage,
      },
    });

    const savedMessage =
      typeof savedMessageStr === "string"
        ? JSON.parse(savedMessageStr)
        : savedMessageStr;

    if (savedMessage?.id) {
      await storeAskEmbedding({
        userId: state.userId,
        threadId: state.threadId,
        content: state.userMessage,
        sourceId: savedMessage.id,
        currentDate: state.currentDate,
      });
    }

    return { userMessageId: savedMessage?.id };
  } catch (error) {
    handleAgentError(error, {
      agentType: "root",
      userId: state.userId,
      action: "save_user_message",
    });
    return {};
  }
}

async function saveAssistantMessageNode(
  state: RootGraphState,
): Promise<Partial<RootGraphState>> {
  if (!state.agentResponse || !state.threadId) {
    return {};
  }

  try {
    if (state.assistantMessageId) {
      await storeAskEmbedding({
        userId: state.userId,
        threadId: state.threadId,
        content: state.agentResponse,
        sourceId: state.assistantMessageId,
        currentDate: state.currentDate,
      });
      return { assistantMessageId: state.assistantMessageId };
    }

    const savedMessageStr = await supabaseStoreTool.invoke({
      table: "ask_messages",
      data: {
        thread_id: state.threadId,
        role: "assistant",
        content: state.agentResponse,
      },
    });

    const savedMessage =
      typeof savedMessageStr === "string"
        ? JSON.parse(savedMessageStr)
        : savedMessageStr;

    if (savedMessage?.id) {
      await storeAskEmbedding({
        userId: state.userId,
        threadId: state.threadId,
        content: state.agentResponse,
        sourceId: savedMessage.id,
        currentDate: state.currentDate,
      });
    }

    // Update thread updated_at
    try {
      const shouldUseAdmin = process.env.TASK_WORKER === "true";
      const supabase = shouldUseAdmin
        ? (await import("@/lib/supabase/admin")).createAdminClient()
        : await (await import("@/lib/supabase/server")).createClient();
      const db = await import("@/lib/supabase/db");
      await db.update(
        supabase,
        "ask_threads",
        { id: state.threadId },
        {
          updated_at: new Date().toISOString(),
        },
      );
    } catch (updateError) {
      console.error("Error updating thread timestamp:", updateError);
      // Don't fail if thread update fails
    }

    return { assistantMessageId: savedMessage?.id };
  } catch (error) {
    handleAgentError(error, {
      agentType: "root",
      userId: state.userId,
      action: "save_assistant_message",
    });
    return {};
  }
}

// Graph Construction

export function createRootMessageGraph() {
  const workflow = new StateGraph<RootGraphState>({
    channels: {
      userId: { reducer: (x: string, y: string) => y ?? x },
      currentDate: { reducer: (x: string, y: string) => y ?? x },
      threadId: { reducer: (x: string, y: string) => y ?? x },
      userMessage: {
        reducer: (x: string | undefined, y: string | undefined) => y ?? x,
      },
      conversationHistory: {
        reducer: (x: string | undefined, y: string | undefined) => y ?? x,
      },
      memoryContext: {
        reducer: (x: string | undefined, y: string | undefined) => y ?? x,
      },
      agentResponse: {
        reducer: (x: string | undefined, y: string | undefined) => y ?? x,
      },
      userEmail: {
        reducer: (x: string | undefined, y: string | undefined) => y ?? x,
      },
      preferredModel: {
        reducer: (x: string | undefined, y: string | undefined) => y ?? x,
      },
      userMessageId: {
        reducer: (x: string | undefined, y: string | undefined) => y ?? x,
      },
      assistantMessageId: {
        reducer: (x: string | undefined, y: string | undefined) => y ?? x,
      },
    },
  })
    .addNode("memoryRetriever", memoryRetrieverNode)
    .addNode("rootResponseAgent", rootResponseAgentNode)
    .addNode("saveUserMessage", saveUserMessageNode)
    .addNode("saveAssistantMessage", saveAssistantMessageNode)
    .addEdge(START, "saveUserMessage")
    .addEdge("saveUserMessage", "memoryRetriever")
    .addEdge("memoryRetriever", "rootResponseAgent")
    .addEdge("rootResponseAgent", "saveAssistantMessage")
    .addEdge("saveAssistantMessage", END);

  return workflow.compile();
}

/** Minimal type for root agent so callers can use .invoke() without casting */
export interface RootAgentInvokable {
  invoke(input: {
    messages: Array<{ role: string; content: string }>;
  }): Promise<{
    messages: Array<{ content?: string | Array<{ text?: string }> }>;
  }>;
}

// Legacy function for backward compatibility
export function createRootAgent(config?: {
  model?: string;
  temperature?: number;
  currentDate?: string;
}): RootAgentInvokable {
  return createBaseAgent({
    systemPrompt: ROOT_AGENT_SYSTEM_PROMPT,
    agentType: "root",
    currentDate: config?.currentDate,
    temperature: config?.temperature,
    model: config?.model,
  }) as RootAgentInvokable;
}

export const rootAgent: RootAgentInvokable = createRootAgent();

// ═══════════════════════════════════════════════════════════════
// AGENTIC MODE INTEGRATION
// ═══════════════════════════════════════════════════════════════

/**
 * Create the agentic root graph using the orchestrator (Composio official pattern).
 * Requires userId to fetch user-scoped Composio tools.
 */
export async function createAgenticRootGraph(userId: string) {
  const { getOrchestratorTools } = await import("../tools/registry");
  const tools = await getOrchestratorTools({ userId });
  return createOrchestratorGraph(tools);
}

/**
 * Unified message processing that respects the agent mode
 * Use this function for automatic mode selection based on AGENT_MODE env var
 */
export async function processRootMessage(
  input: {
    userId: string;
    threadId: string;
    userMessage: string;
    currentDate?: string;
    userEmail?: string;
    conversationHistory?: string;
    preferredModel?: string;
  },
  options?: {
    forceMode?: AgentMode;
  },
): Promise<RootMessageResult & { mode: AgentMode; toolsUsed?: string[] }> {
  const mode = options?.forceMode || getAgentMode();

  if (mode === "agentic") {
    // Use the new orchestrator with autonomous tool selection
    console.log("[processRootMessage] Using agentic mode (orchestrator)");

    const result = await processOrchestratorMessage({
      userId: input.userId,
      threadId: input.threadId,
      userMessage: input.userMessage,
      currentDate: input.currentDate,
      userEmail: input.userEmail,
      conversationHistory: input.conversationHistory,
      preferredModel: input.preferredModel,
    });

    return {
      agentResponse: result.agentResponse,
      userMessageId: result.userMessageId,
      assistantMessageId: result.assistantMessageId,
      mode: "agentic",
      toolsUsed: result.toolsUsed,
    };
  } else {
    // Use the original linear flow
    console.log("[processRootMessage] Using linear mode (original)");

    const graph = createRootMessageGraph();
    const result = await graph.invoke({
      userId: input.userId,
      threadId: input.threadId,
      userMessage: input.userMessage,
      currentDate: input.currentDate || new Date().toISOString().split("T")[0],
      userEmail: input.userEmail,
      conversationHistory: input.conversationHistory,
      preferredModel: input.preferredModel,
    });

    return {
      agentResponse: result.agentResponse || "",
      userMessageId: result.userMessageId,
      assistantMessageId: result.assistantMessageId,
      mode: "linear",
    };
  }
}

/**
 * Get the appropriate graph based on current mode.
 * For agentic mode, userId is required (Composio tools are user-scoped).
 */
export async function getRootGraph(mode?: AgentMode, userId?: string) {
  const effectiveMode = mode || getAgentMode();

  if (effectiveMode === "agentic" && userId) {
    return createAgenticRootGraph(userId);
  }

  return createRootMessageGraph();
}

// Re-export orchestrator types for convenience
export type { OrchestratorMessageResult } from "./orchestrator.agent";

// Export nodes for durable task handlers
export {
  saveUserMessageNode,
  memoryRetrieverNode,
  rootResponseAgentNode,
  saveAssistantMessageNode,
};
