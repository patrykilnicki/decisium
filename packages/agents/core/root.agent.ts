import { StateGraph, END, START } from "@langchain/langgraph";
import { createBaseAgent } from "../lib/agent-base";
import {
  memorySearchTool,
  supabaseStoreTool,
  embeddingGeneratorTool,
} from "../tools";
import { buildMemoryContext, buildAgentContext } from "../lib/context";
import { handleAgentError } from "../lib/error-handler";
import { 
  createOrchestratorGraph, 
  processOrchestratorMessage,
  type OrchestratorMessageResult 
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
  userMessageId?: string;
  assistantMessageId?: string;
}

export interface RootMessageResult {
  agentResponse: string;
  userMessageId?: string;
  assistantMessageId?: string;
}

// Node Implementations

async function memoryRetrieverNode(
  state: RootGraphState
): Promise<Partial<RootGraphState>> {
  if (!state.userMessage) {
    return {};
  }

  try {
    const resultStr = await memorySearchTool.invoke({
      userId: state.userId,
      query: state.userMessage,
    });

    const result = typeof resultStr === "string" ? JSON.parse(resultStr) : resultStr;
    const memoryContext = buildMemoryContext([result]);

    return { memoryContext };
  } catch (error) {
    handleAgentError(error, {
      agentType: "root",
      userId: state.userId,
      action: "memory_retrieval",
    });
    return { memoryContext: "" };
  }
}

async function rootResponseAgentNode(
  state: RootGraphState
): Promise<Partial<RootGraphState>> {
  if (!state.userMessage) {
    return {};
  }

  const responseAgent = createBaseAgent({
    systemPrompt: ROOT_AGENT_SYSTEM_PROMPT,
    agentType: "root",
    currentDate: state.currentDate,
  });

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

  // Type assertion to avoid deep type inference issues with LangChain types
  const result = await (responseAgent.invoke as any)(
    {
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    },
    { recursionLimit: 15 }
  );

  // Extract response content, handling both string and array types
  const lastMessage = result.messages?.[result.messages.length - 1];
  let agentResponse = "";
  
  if (lastMessage?.content) {
    if (typeof lastMessage.content === "string") {
      agentResponse = lastMessage.content;
    } else if (Array.isArray(lastMessage.content)) {
      // Handle array of content blocks (extract text from each)
      agentResponse = lastMessage.content
        .map((block: any) => (typeof block === "string" ? block : block?.text || ""))
        .join("");
    }
  }

  return { agentResponse };
}

async function saveUserMessageNode(
  state: RootGraphState
): Promise<Partial<RootGraphState>> {
  if (!state.userMessage || !state.threadId) {
    return {};
  }

  try {
    const savedMessageStr = await supabaseStoreTool.invoke({
      table: "ask_messages",
      data: {
        thread_id: state.threadId,
        role: "user",
        content: state.userMessage,
      },
    });

    const savedMessage = typeof savedMessageStr === "string"
      ? JSON.parse(savedMessageStr)
      : savedMessageStr;

    // Generate and store embedding for user message
    if (savedMessage?.id && state.userMessage) {
      try {
        const embeddingResultStr = await embeddingGeneratorTool.invoke({
          content: state.userMessage,
        });
        const embeddingResult = typeof embeddingResultStr === "string"
          ? JSON.parse(embeddingResultStr)
          : embeddingResultStr;

        if (
          embeddingResult?.embedding &&
          Array.isArray(embeddingResult.embedding) &&
          embeddingResult.embedding.length > 0
        ) {
          await supabaseStoreTool.invoke({
            table: "embeddings",
            data: {
              user_id: state.userId,
              content: state.userMessage,
              embedding: embeddingResult.embedding,
              metadata: {
                type: "ask_message",
                source_id: savedMessage.id,
                thread_id: state.threadId,
                date: state.currentDate,
              },
            },
          });
        }
      } catch (embeddingError) {
        console.error("Error storing embedding for user message:", embeddingError);
        // Don't fail the message save if embedding fails
      }
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
  state: RootGraphState
): Promise<Partial<RootGraphState>> {
  if (!state.agentResponse || !state.threadId) {
    return {};
  }

  try {
    const savedMessageStr = await supabaseStoreTool.invoke({
      table: "ask_messages",
      data: {
        thread_id: state.threadId,
        role: "assistant",
        content: state.agentResponse,
      },
    });

    const savedMessage = typeof savedMessageStr === "string"
      ? JSON.parse(savedMessageStr)
      : savedMessageStr;

    // Generate and store embedding for assistant message
    if (savedMessage?.id && state.agentResponse) {
      try {
        const embeddingResultStr = await embeddingGeneratorTool.invoke({
          content: state.agentResponse,
        });
        const embeddingResult = typeof embeddingResultStr === "string"
          ? JSON.parse(embeddingResultStr)
          : embeddingResultStr;

        if (
          embeddingResult?.embedding &&
          Array.isArray(embeddingResult.embedding) &&
          embeddingResult.embedding.length > 0
        ) {
          await supabaseStoreTool.invoke({
            table: "embeddings",
            data: {
              user_id: state.userId,
              content: state.agentResponse,
              embedding: embeddingResult.embedding,
              metadata: {
                type: "ask_message",
                source_id: savedMessage.id,
                thread_id: state.threadId,
                date: state.currentDate,
              },
            },
          });
        }
      } catch (embeddingError) {
        console.error("Error storing embedding for assistant message:", embeddingError);
        // Don't fail the message save if embedding fails
      }
    }

    // Update thread updated_at
    try {
      const { createClient } = await import("@/lib/supabase/server");
      const supabase = await createClient();
      await supabase
        .from("ask_threads")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", state.threadId);
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

// Legacy function for backward compatibility
export function createRootAgent(config?: {
  llmProvider?: "openai" | "anthropic" | "openrouter";
  model?: string;
  temperature?: number;
  currentDate?: string;
}): any {
  return createBaseAgent({
    systemPrompt: ROOT_AGENT_SYSTEM_PROMPT,
    agentType: "root",
    currentDate: config?.currentDate,
    temperature: config?.temperature,
    llmProvider: config?.llmProvider,
    model: config?.model,
  });
}

export const rootAgent: any = createRootAgent();

// ═══════════════════════════════════════════════════════════════
// AGENTIC MODE INTEGRATION
// ═══════════════════════════════════════════════════════════════

/**
 * Create the agentic root graph using the orchestrator
 * This uses autonomous tool selection and document grading
 */
export function createAgenticRootGraph() {
  return createOrchestratorGraph();
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
  },
  options?: {
    forceMode?: AgentMode;
  }
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
 * Get the appropriate graph based on current mode
 */
export function getRootGraph(mode?: AgentMode) {
  const effectiveMode = mode || getAgentMode();
  
  if (effectiveMode === "agentic") {
    return createAgenticRootGraph();
  }
  
  return createRootMessageGraph();
}

// Re-export orchestrator types for convenience
export type { OrchestratorMessageResult } from "./orchestrator.agent";
