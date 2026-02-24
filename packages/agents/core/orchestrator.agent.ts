import { StateGraph, END, START } from "@langchain/langgraph";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { DynamicStructuredTool } from "@langchain/core/tools";

import { hasToolCalls } from "../lib/router";
import { getOrchestratorTools } from "../tools/registry";
import { supabaseStoreTool, embeddingGeneratorTool } from "../tools";
import { handleAgentError } from "../lib/error-handler";
import { logLlmUsage } from "../lib/llm-usage";
import { logPromptPayload } from "../lib/prompt-logs";
import { createLLM } from "../lib/llm";
import {
  type OrchestratorState,
  orchestratorChannels,
  createInitialOrchestratorState,
} from "../schemas/orchestrator.schema";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "../prompts";
import {
  listComposioConnectedAccounts,
  isComposioEnabled,
} from "../lib/composio";

// ═══════════════════════════════════════════════════════════════
// NODE IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Agent node - invokes LLM with full message history (official Composio pattern).
 * Receives state.messages including previous AIMessage + ToolMessage so it can
 * follow up (e.g. COMPOSIO_SEARCH_TOOLS → COMPOSIO_MANAGE_CONNECTIONS → COMPOSIO_MULTI_EXECUTE_TOOL).
 */
async function agentNode(
  state: OrchestratorState,
  tools: DynamicStructuredTool[],
): Promise<Partial<OrchestratorState>> {
  const llm = createLLM({
    model: state.preferredModel || process.env.LLM_MODEL,
    temperature: 0.1,
  });
  const llmWithTools = llm.bindTools(tools);

  const connectedServicesText =
    state.connectedServices ??
    "No external services connected. Use COMPOSIO_MANAGE_CONNECTIONS if the user asks about calendar or email.";

  const systemPrompt = ORCHESTRATOR_SYSTEM_PROMPT.replace(
    /{{currentDate}}/g,
    state.currentDate,
  ).replace(/{{connectedServices}}/g, connectedServicesText);

  // Build messages: SystemMessage + conversation (Human, AI, Tool, ...)
  const messagesToSend: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    ...state.messages,
  ];

  try {
    await logPromptPayload({
      userId: state.userId,
      agentType: "orchestrator_agent",
      nodeKey: "agent",
      taskType: "orchestrator.agent",
      model: state.preferredModel || process.env.LLM_MODEL || "openai/gpt-4o",
      temperature: 0.1,
      systemPrompt,
      messages: messagesToSend,
      metadata: {
        connectedServices: connectedServicesText,
      },
    });

    const response = await llmWithTools.invoke(messagesToSend);
    await logLlmUsage({
      response,
      userId: state.userId,
      agentType: "orchestrator_agent",
      nodeKey: "agent",
      taskType: "orchestrator.agent",
    });

    if (hasToolCalls(response)) {
      console.log(
        `[agentNode] Tool calls: ${(response as AIMessage).tool_calls?.map((t) => t.name).join(", ")}`,
      );
      return {
        messages: [response as BaseMessage],
        iterationCount: state.iterationCount + 1,
      };
    }

    // No tool calls - extract final response
    const content =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .map((c: unknown) =>
                typeof c === "string"
                  ? c
                  : ((c as { text?: string }).text ?? ""),
              )
              .join("")
          : "";

    // Collect tools used from messages (AIMessages with tool_calls)
    const toolsUsed: string[] = [];
    for (const msg of state.messages) {
      if (msg instanceof AIMessage && msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          if (tc.name) toolsUsed.push(tc.name);
        }
      }
    }

    return {
      messages: [response as BaseMessage],
      agentResponse: content,
      toolsUsed: toolsUsed.length ? toolsUsed : state.toolsUsed,
      nextRoute: "saveMessages",
      iterationCount: state.iterationCount + 1,
    };
  } catch (error) {
    handleAgentError(error, {
      agentType: "orchestrator",
      userId: state.userId,
      action: "agent",
    });
    return {
      agentResponse:
        "I apologize, but I encountered an error processing your request. Please try again.",
      nextRoute: "saveMessages",
    };
  }
}

/**
 * Save messages node - persists conversation to database
 */
async function saveMessagesNode(
  state: OrchestratorState,
): Promise<Partial<OrchestratorState>> {
  if (!state.userMessage || !state.threadId) {
    return { nextRoute: "end" };
  }

  try {
    let savedUserId = state.userMessageId;
    if (!savedUserId) {
      const savedUserStr = await supabaseStoreTool.invoke({
        table: "ask_messages",
        data: {
          thread_id: state.threadId,
          role: "user",
          content: state.userMessage,
        },
      });
      const savedUser = JSON.parse(savedUserStr);
      savedUserId = savedUser?.id;
    }

    // Generate embedding for user message
    if (savedUserId) {
      try {
        const embeddingResultStr = await embeddingGeneratorTool.invoke({
          content: state.userMessage,
        });
        const embeddingResult = JSON.parse(embeddingResultStr);

        if (embeddingResult?.embedding?.length > 0) {
          await supabaseStoreTool.invoke({
            table: "embeddings",
            data: {
              user_id: state.userId,
              content: state.userMessage,
              embedding: embeddingResult.embedding,
              metadata: {
                type: "ask_message",
                source_id: savedUserId,
                thread_id: state.threadId,
                date: state.currentDate,
              },
            },
          });
        }
      } catch (e) {
        console.error(
          "[saveMessagesNode] Error storing user message embedding:",
          e,
        );
      }
    }

    // Save assistant message
    let savedAssistantId: string | undefined = state.assistantMessageId;
    if (state.agentResponse && !savedAssistantId) {
      const savedAssistantStr = await supabaseStoreTool.invoke({
        table: "ask_messages",
        data: {
          thread_id: state.threadId,
          role: "assistant",
          content: state.agentResponse,
        },
      });
      const savedAssistant = JSON.parse(savedAssistantStr);
      savedAssistantId = savedAssistant?.id;
    }

    // Generate embedding for assistant message
    if (savedAssistantId && state.agentResponse) {
      try {
        const embeddingResultStr = await embeddingGeneratorTool.invoke({
          content: state.agentResponse,
        });
        const embeddingResult = JSON.parse(embeddingResultStr);

        if (embeddingResult?.embedding?.length > 0) {
          await supabaseStoreTool.invoke({
            table: "embeddings",
            data: {
              user_id: state.userId,
              content: state.agentResponse,
              embedding: embeddingResult.embedding,
              metadata: {
                type: "ask_message",
                source_id: savedAssistantId,
                thread_id: state.threadId,
                date: state.currentDate,
              },
            },
          });
        }
      } catch (e) {
        console.error(
          "[saveMessagesNode] Error storing assistant message embedding:",
          e,
        );
      }
    }

    // Update thread timestamp
    try {
      const shouldUseAdmin = process.env.TASK_WORKER === "true";
      const supabase = shouldUseAdmin
        ? (await import("@/lib/supabase/admin")).createAdminClient()
        : await (await import("@/lib/supabase/server")).createClient();
      await supabase
        .from("ask_threads")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", state.threadId);
    } catch (e) {
      console.error("[saveMessagesNode] Error updating thread timestamp:", e);
    }

    return {
      userMessageId: savedUserId,
      assistantMessageId: savedAssistantId,
      nextRoute: "end",
    };
  } catch (error) {
    handleAgentError(error, {
      agentType: "orchestrator",
      userId: state.userId,
      action: "save_messages",
    });
    return { nextRoute: "end" };
  }
}

// ═══════════════════════════════════════════════════════════════
// ROUTING FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Route after agent: tools (if tool_calls) or saveMessages (if done)
 */
function routeAfterAgent(state: OrchestratorState): "tools" | "saveMessages" {
  if (state.nextRoute === "saveMessages") {
    return "saveMessages";
  }
  if (state.iterationCount >= state.maxIterations) {
    console.warn("[routeAfterAgent] Max iterations reached, forcing save");
    return "saveMessages";
  }
  const messages = state.messages ?? [];
  const lastMessage = messages[messages.length - 1];
  if (lastMessage && "tool_calls" in lastMessage) {
    const aiMsg = lastMessage as AIMessage;
    if (aiMsg.tool_calls?.length) return "tools";
  }
  return "saveMessages";
}

/**
 * ToolNode adapter: LangGraph ToolNode expects state.messages. Our state has it.
 * Wrap to pass through OrchestratorState.
 */
function createToolNode(tools: DynamicStructuredTool[]) {
  const toolNode = new ToolNode(tools);
  return async (state: OrchestratorState) => {
    const result = await toolNode.invoke(
      { messages: state.messages },
      { configurable: {} },
    );
    return { messages: result.messages } as Partial<OrchestratorState>;
  };
}

// ═══════════════════════════════════════════════════════════════
// GRAPH CONSTRUCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Create the agentic orchestrator graph (Composio official pattern).
 * Agent ↔ Tools loop: tools always route back to agent for multi-round tool use.
 */
export function createOrchestratorGraph(tools: DynamicStructuredTool[]) {
  const toolNode = createToolNode(tools);

  const workflow = new StateGraph<OrchestratorState>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LangGraph channels type
    channels: orchestratorChannels as any,
  })
    .addNode("agent", (state) => agentNode(state, tools))
    .addNode("tools", toolNode)
    .addNode("saveMessages", saveMessagesNode)

    .addEdge(START, "agent")
    .addConditionalEdges("agent", routeAfterAgent, {
      tools: "tools",
      saveMessages: "saveMessages",
    })
    .addEdge("tools", "agent")
    .addEdge("saveMessages", END);

  return workflow.compile();
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

export interface OrchestratorMessageResult {
  agentResponse: string;
  userMessageId?: string;
  assistantMessageId?: string;
  toolsUsed?: string[];
  rewriteCount?: number;
}

/**
 * Build a human-readable summary of which Composio toolkits are connected.
 * This is injected into the system prompt so the agent knows what's available
 * without needing to call COMPOSIO_SEARCH_TOOLS (which burns iterations).
 */
async function buildConnectedServicesText(userId: string): Promise<string> {
  if (!isComposioEnabled()) return "Composio not configured.";

  const TOOLKITS = [
    { slug: "GOOGLECALENDAR", label: "Google Calendar" },
    { slug: "GMAIL", label: "Gmail" },
  ] as const;

  const lines: string[] = [];
  for (const { slug, label } of TOOLKITS) {
    try {
      const accounts = await listComposioConnectedAccounts(userId, slug);
      const status = accounts.length > 0 ? "CONNECTED" : "NOT CONNECTED";
      lines.push(`- ${label}: ${status}`);
    } catch {
      lines.push(`- ${label}: UNKNOWN`);
    }
  }

  return lines.join("\n");
}

export async function processOrchestratorMessage(input: {
  userId: string;
  threadId: string;
  userMessage: string;
  currentDate?: string;
  userEmail?: string;
  conversationHistory?: string;
  callbackUrl?: string;
  preferredModel?: string;
}): Promise<OrchestratorMessageResult> {
  const [tools, connectedServices] = await Promise.all([
    getOrchestratorTools({
      userId: input.userId,
      callbackUrl: input.callbackUrl,
    }),
    buildConnectedServicesText(input.userId),
  ]);

  const graph = createOrchestratorGraph(tools);
  const initialState = createInitialOrchestratorState({
    ...input,
    connectedServices,
  });

  const result = await graph.invoke(initialState);

  return {
    agentResponse:
      result.agentResponse ||
      "I apologize, but I couldn't generate a response.",
    userMessageId: result.userMessageId,
    assistantMessageId: result.assistantMessageId,
    toolsUsed: result.toolsUsed,
    rewriteCount: result.rewriteCount,
  };
}

// Export for testing
export { agentNode, saveMessagesNode, routeAfterAgent, createToolNode };
