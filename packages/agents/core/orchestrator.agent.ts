import { StateGraph, END, START } from "@langchain/langgraph";
import {
  SystemMessage,
  AIMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { DynamicStructuredTool } from "@langchain/core/tools";

import { getCurrentDate } from "../lib/date-utils";
import { hasToolCalls } from "../lib/router";
import { getOrchestratorTools } from "../tools/registry";
import { supabaseStoreTool } from "../tools";
import { handleAgentError } from "../lib/error-handler";
import { logLlmUsage } from "../lib/llm-usage";
import { logPromptPayload } from "../lib/prompt-logs";
import { createLLM } from "../lib/llm";
import {
  type OrchestratorState,
  orchestratorChannels,
  createInitialOrchestratorState,
  type PendingApproval,
} from "../schemas/orchestrator.schema";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "../prompts";
import {
  getFriendlyToolLabel,
  GENERATE_TODO_LIST_STARTED_LABELS,
} from "../lib/step-mappings";
import {
  listComposioConnectedAccounts,
  isComposioEnabled,
} from "../lib/composio";
import { createAdminClient } from "@/lib/supabase/admin";
import { storeMemory } from "@/lib/memory/memory-service";
import { taskApprovalCardPropsSchema } from "../schemas/agent-ui.schema";

import { createTodoGenerator } from "@/lib/integrations";
import { applyApprovedTodoItemsTool } from "../tools";

// ═══════════════════════════════════════════════════════════════
// CONTENT EXTRACTION
// ═══════════════════════════════════════════════════════════════

/**
 * Extract text from AIMessage content. Handles various formats:
 * - string
 * - Array of blocks: { text }, { type: "text", text }, { parts: [{ text }] } (Gemini)
 */
function extractTextFromAIMessageContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((c: unknown) => {
      if (typeof c === "string") return c;
      if (c == null || typeof c !== "object") return "";
      const block = c as Record<string, unknown>;
      // Standard: { text: "..." } or { type: "text", text: "..." }
      if (typeof block.text === "string") return block.text;
      // Gemini-style: { parts: [{ text: "..." }] }
      if (Array.isArray(block.parts)) {
        return block.parts
          .map((p: unknown) =>
            typeof p === "string"
              ? p
              : p != null && typeof p === "object" && "text" in (p as object)
                ? String((p as { text?: unknown }).text ?? "")
                : "",
          )
          .join("");
      }
      return "";
    })
    .join("");
}

function parsePendingApprovalFromToolOutput(
  output: string,
): PendingApproval | null {
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    if (parsed.component !== "task_approval_card") return null;
    if (typeof parsed.proposalId !== "string") return null;
    const props = taskApprovalCardPropsSchema.parse(parsed.props);
    return {
      proposalId: parsed.proposalId,
      component: "task_approval_card",
      props,
    };
  } catch {
    return null;
  }
}

function buildApprovalPendingResponse(): string {
  return "I prepared a task proposal. Review the approval card below and choose Approve, Edit, or Reject.";
}

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
    model: state.preferredModel || process.env.LLM_MODEL || "openai/gpt-4o",
    temperature: 0.1,
    maxTokens: 8192,
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

    // No tool calls - extract final response (handles multiple content formats)
    const rawContent = extractTextFromAIMessageContent(response.content);
    const content =
      typeof rawContent === "string" && rawContent.trim().length > 0
        ? rawContent
        : (() => {
            const model =
              state.preferredModel || process.env.LLM_MODEL || "openai/gpt-4o";
            console.warn(
              `[agentNode] Empty LLM response for model ${model}. Response content type: ${typeof response.content}, ` +
                (Array.isArray(response.content)
                  ? `blocks: ${response.content.length}`
                  : "not array"),
            );
            return "I couldn't generate a response. The model returned no output. Try a different model (e.g. GPT-4o or Gemini 2.0 Flash) or a shorter request.";
          })();
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

async function approvalEntryNode(
  state: OrchestratorState,
  onToolEvent?: (event: OrchestratorToolEvent) => Promise<void> | void,
): Promise<Partial<OrchestratorState>> {
  if (!state.pendingApproval) {
    return { nextRoute: undefined };
  }

  const decision = state.approvalDecision;
  if (!decision) {
    return {
      agentResponse: buildApprovalPendingResponse(),
      nextRoute: "saveMessages",
      approvalStatus: "pending",
    };
  }

  if (decision === "reject") {
    return {
      pendingApproval: undefined,
      approvalDecision: undefined,
      approvalEditedProps: undefined,
      approvalStatus: "rejected",
      agentResponse: "Understood. I did not create any tasks.",
      nextRoute: "saveMessages",
    };
  }

  const approvedProps = taskApprovalCardPropsSchema.parse(
    decision === "edit"
      ? (state.approvalEditedProps ?? state.pendingApproval.props)
      : state.pendingApproval.props,
  );

  const applyToolCall: PendingToolCall = {
    toolName: "apply_approved_todo_items",
    toolCallId: `approval_apply:${state.pendingApproval.proposalId}`,
    toolCallKey: `apply_approved_todo_items:${state.pendingApproval.proposalId}`,
    callIndex: 1,
  };

  await emitToolEvent({
    onToolEvent,
    eventType: "tool_started",
    tool: applyToolCall,
    displayLabelOverride: "Applying approved tasks...",
  });

  try {
    await applyApprovedTodoItemsTool.func({
      userId: state.userId,
      proposalId: state.pendingApproval.proposalId,
      props: approvedProps,
    });
    await emitToolEvent({
      onToolEvent,
      eventType: "tool_completed",
      tool: applyToolCall,
      displayLabelOverride: "Approved tasks applied",
    });
  } catch (error) {
    await emitToolEvent({
      onToolEvent,
      eventType: "tool_failed",
      tool: applyToolCall,
      error: error instanceof Error ? error.message : String(error),
      displayLabelOverride: "Could not apply approved tasks",
    });
    throw error;
  }

  return {
    pendingApproval: undefined,
    approvalDecision: undefined,
    approvalEditedProps: undefined,
    approvalStatus: "applied",
    agentResponse: `Saved ${approvedProps.items.length} task(s).`,
    nextRoute: "saveMessages",
  };
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
        await storeMemory({
          userId: state.userId,
          content: state.userMessage,
          memoryType: "conversation",
          source: "agent",
          sourceId: savedUserId,
          ttl: "7 days",
          metadata: {
            type: "ask_message",
            thread_id: state.threadId,
            date: state.currentDate,
          },
        });
      } catch (e) {
        console.error(
          "[saveMessagesNode] Error storing user message embedding:",
          e,
        );
      }
    }

    // Save assistant message (always persist something when we reach saveMessages)
    const FALLBACK_RESPONSE =
      "I apologize, but I couldn't generate a response.";
    const assistantContent = state.agentResponse?.trim() || FALLBACK_RESPONSE;
    let savedAssistantId: string | undefined = state.assistantMessageId;
    if (assistantContent && !savedAssistantId) {
      const savedAssistantStr = await supabaseStoreTool.invoke({
        table: "ask_messages",
        data: {
          thread_id: state.threadId,
          role: "assistant",
          content: assistantContent,
        },
      });
      const savedAssistant = JSON.parse(savedAssistantStr);
      savedAssistantId = savedAssistant?.id;
    }

    // Generate embedding for assistant message
    if (savedAssistantId && assistantContent) {
      try {
        await storeMemory({
          userId: state.userId,
          content: assistantContent,
          memoryType: "conversation",
          source: "agent",
          sourceId: savedAssistantId,
          ttl: "7 days",
          metadata: {
            type: "ask_message",
            thread_id: state.threadId,
            date: state.currentDate,
          },
        });
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
      const db = await import("@/lib/supabase/db");
      await db.update(
        supabase,
        "ask_threads",
        { id: state.threadId },
        {
          updated_at: new Date().toISOString(),
        },
      );
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

function routeAfterApprovalEntry(
  state: OrchestratorState,
): "agent" | "saveMessages" {
  return state.nextRoute === "saveMessages" ? "saveMessages" : "agent";
}

function routeAfterTools(state: OrchestratorState): "agent" | "saveMessages" {
  return state.nextRoute === "saveMessages" ? "saveMessages" : "agent";
}

interface PendingToolCall {
  toolName: string;
  toolCallId: string;
  toolCallKey: string;
  callIndex: number;
  innerToolSlugs?: string[];
  args?: Record<string, unknown>;
}

export interface OrchestratorToolEvent {
  eventType:
    | "tool_started"
    | "tool_completed"
    | "tool_failed"
    | "approval_required"
    | "approval_applied"
    | "approval_rejected";
  toolName: string;
  toolCallId: string;
  toolCallKey: string;
  callIndex: number;
  action: "checking" | "completed" | "failed";
  displayLabel: string;
  error?: string;
  payload?: Record<string, unknown>;
}

function extractInnerToolSlugs(args: Record<string, unknown>): string[] {
  const tools = args?.tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .map((t) => (t as { tool_slug?: string })?.tool_slug)
    .filter(
      (slug): slug is string => typeof slug === "string" && slug.length > 0,
    );
}

function getPendingToolCalls(messages: BaseMessage[]): PendingToolCall[] {
  const lastMessage = messages[messages.length - 1];
  if (!(lastMessage instanceof AIMessage)) return [];

  const toolCalls = Array.isArray(lastMessage.tool_calls)
    ? lastMessage.tool_calls
    : [];
  return toolCalls.reduce<PendingToolCall[]>((acc, toolCall, index) => {
    const toolName =
      typeof toolCall?.name === "string" ? toolCall.name.trim() : "";
    if (!toolName) return acc;

    const fallbackId = `${toolName}:${index + 1}`;
    const toolCallId =
      typeof toolCall?.id === "string" && toolCall.id.trim().length > 0
        ? toolCall.id
        : fallbackId;

    const args =
      toolCall?.args && typeof toolCall.args === "object"
        ? (toolCall.args as Record<string, unknown>)
        : undefined;
    const innerToolSlugs = args ? extractInnerToolSlugs(args) : undefined;

    acc.push({
      toolName,
      toolCallId,
      toolCallKey: `${toolName}:${index + 1}`,
      callIndex: index + 1,
      innerToolSlugs: innerToolSlugs?.length ? innerToolSlugs : undefined,
      args,
    });
    return acc;
  }, []);
}

async function emitToolEvent(params: {
  onToolEvent?: (event: OrchestratorToolEvent) => Promise<void> | void;
  eventType: OrchestratorToolEvent["eventType"];
  tool: PendingToolCall;
  error?: string;
  displayLabelOverride?: string;
}): Promise<void> {
  if (!params.onToolEvent) return;

  const friendlyLabel =
    params.displayLabelOverride ??
    getFriendlyToolLabel(
      params.eventType,
      params.tool.toolName,
      params.tool.innerToolSlugs,
    );

  const action =
    params.eventType === "tool_completed"
      ? "completed"
      : params.eventType === "tool_failed"
        ? "failed"
        : "checking";

  const event: OrchestratorToolEvent = {
    eventType: params.eventType,
    toolName: params.tool.toolName,
    toolCallId: params.tool.toolCallId,
    toolCallKey: params.tool.toolCallKey,
    callIndex: params.tool.callIndex,
    action,
    displayLabel: friendlyLabel,
  };

  if (params.eventType === "tool_failed" && params.error) {
    event.error = params.error;
  }

  try {
    await params.onToolEvent(event);
  } catch (error) {
    console.error("[orchestrator] Failed to emit tool event:", error);
  }
}

/**
 * ToolNode adapter: LangGraph ToolNode expects state.messages. Our state has it.
 * Wrap to pass through OrchestratorState.
 */
function createToolNode(
  tools: DynamicStructuredTool[],
  onToolEvent?: (event: OrchestratorToolEvent) => Promise<void> | void,
) {
  const toolNode = new ToolNode(tools);
  return async (state: OrchestratorState) => {
    const pendingTools = getPendingToolCalls(state.messages);
    const today = state.currentDate ?? getCurrentDate();
    await Promise.all(
      pendingTools.map(async (tool) => {
        let displayLabelOverride: string | undefined;
        if (
          tool.toolName === "generate_todo_list" &&
          state.userId &&
          tool.args
        ) {
          const date =
            (typeof tool.args.date === "string" ? tool.args.date : null) ??
            today;
          const generator = createTodoGenerator(createAdminClient());
          const hasSnapshot = await generator.hasSnapshotForDate(
            state.userId,
            date,
          );
          displayLabelOverride = hasSnapshot
            ? GENERATE_TODO_LIST_STARTED_LABELS.fromCache
            : GENERATE_TODO_LIST_STARTED_LABELS.generating;
        }
        return emitToolEvent({
          onToolEvent,
          eventType: "tool_started",
          tool,
          displayLabelOverride,
        });
      }),
    );

    try {
      const result = await toolNode.invoke(
        { messages: state.messages },
        { configurable: {} },
      );

      const proposalIndex = pendingTools.findIndex(
        (tool) => tool.toolName === "propose_todo_items",
      );
      if (proposalIndex >= 0) {
        const proposalToolCallId = pendingTools[proposalIndex].toolCallId;
        const reversedMessages = [...result.messages].reverse();
        const toolMessage =
          reversedMessages.find(
            (message) =>
              message instanceof ToolMessage &&
              typeof message.tool_call_id === "string" &&
              message.tool_call_id === proposalToolCallId,
          ) ??
          reversedMessages.find((message) => message instanceof ToolMessage);
        const rawContent =
          toolMessage instanceof ToolMessage
            ? toolMessage.content
            : typeof (toolMessage as { content?: unknown })?.content ===
                "string"
              ? (toolMessage as { content: string }).content
              : "";
        const pendingApproval = parsePendingApprovalFromToolOutput(
          typeof rawContent === "string" ? rawContent : "",
        );

        if (pendingApproval) {
          await emitToolEvent({
            onToolEvent,
            eventType: "tool_completed",
            tool: pendingTools[proposalIndex],
            displayLabelOverride: "Task proposal ready",
          });

          return {
            messages: result.messages,
            pendingApproval,
            approvalStatus: "pending",
            nextRoute: "saveMessages",
            agentResponse: buildApprovalPendingResponse(),
          } as Partial<OrchestratorState>;
        }
      }

      await Promise.all(
        pendingTools.map((tool) =>
          emitToolEvent({
            onToolEvent,
            eventType: "tool_completed",
            tool,
          }),
        ),
      );
      return {
        messages: result.messages,
        nextRoute: undefined,
      } as Partial<OrchestratorState>;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await Promise.all(
        pendingTools.map((tool) =>
          emitToolEvent({
            onToolEvent,
            eventType: "tool_failed",
            tool,
            error: errorMessage,
          }),
        ),
      );
      throw error;
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// GRAPH CONSTRUCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Create the agentic orchestrator graph (Composio official pattern).
 * Agent ↔ Tools loop: tools always route back to agent for multi-round tool use.
 */
export function createOrchestratorGraph(
  tools: DynamicStructuredTool[],
  onToolEvent?: (event: OrchestratorToolEvent) => Promise<void> | void,
) {
  const toolNode = createToolNode(tools, onToolEvent);

  const workflow = new StateGraph<OrchestratorState>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LangGraph channels type
    channels: orchestratorChannels as any,
  })
    .addNode("approvalEntry", (state) => approvalEntryNode(state, onToolEvent))
    .addNode("agent", (state) => agentNode(state, tools))
    .addNode("tools", toolNode)
    .addNode("saveMessages", saveMessagesNode)
    .addEdge(START, "approvalEntry")
    .addConditionalEdges("approvalEntry", routeAfterApprovalEntry, {
      agent: "agent",
      saveMessages: "saveMessages",
    })
    .addConditionalEdges("agent", routeAfterAgent, {
      tools: "tools",
      saveMessages: "saveMessages",
    })
    .addConditionalEdges("tools", routeAfterTools, {
      agent: "agent",
      saveMessages: "saveMessages",
    })
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
  pendingApproval?: PendingApproval;
  approvalStatus?: "pending" | "approved" | "edited" | "rejected" | "applied";
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
  timezone?: string;
  userEmail?: string;
  conversationHistory?: string;
  callbackUrl?: string;
  preferredModel?: string;
  userMessageId?: string;
  pendingApproval?: PendingApproval;
  approvalDecision?: "approve" | "edit" | "reject";
  approvalEditedProps?: Record<string, unknown>;
  approvalStatus?: "pending" | "approved" | "edited" | "rejected" | "applied";
  onToolEvent?: (event: OrchestratorToolEvent) => Promise<void> | void;
}): Promise<OrchestratorMessageResult> {
  const [tools, connectedServices] = await Promise.all([
    getOrchestratorTools({
      userId: input.userId,
      callbackUrl: input.callbackUrl,
      threadId: input.threadId,
      userMessage: input.userMessage,
      currentDate: input.currentDate,
      timezone: input.timezone,
      preferredModel: input.preferredModel,
    }),
    buildConnectedServicesText(input.userId),
  ]);

  const graph = createOrchestratorGraph(tools, input.onToolEvent);
  const initialState = createInitialOrchestratorState({
    ...input,
    connectedServices,
    userMessageId: input.userMessageId,
    pendingApproval: input.pendingApproval,
    approvalDecision: input.approvalDecision,
    approvalEditedProps: input.approvalEditedProps as
      | OrchestratorState["approvalEditedProps"]
      | undefined,
    approvalStatus: input.approvalStatus,
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
    pendingApproval: result.pendingApproval,
    approvalStatus: result.approvalStatus,
  };
}

// Export for testing
export { agentNode, saveMessagesNode, routeAfterAgent, createToolNode };
