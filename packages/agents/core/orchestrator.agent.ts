import { StateGraph, END, START } from "@langchain/langgraph";
import { HumanMessage, ToolMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import { createRouterAgent, hasToolCalls, extractToolCalls } from "../lib/router";
import { gradeDocumentsNode, routeAfterGrading } from "../nodes/grade-documents.node";
import { rewriteQueryNode } from "../nodes/rewrite-query.node";
import { getOrchestratorTools } from "../tools/registry";
import { memorySearchTool, supabaseStoreTool, embeddingGeneratorTool } from "../tools";
import { buildMemoryContext } from "../lib/context";
import { handleAgentError } from "../lib/error-handler";
import { createLLM } from "../lib/llm";
import {
  type OrchestratorState,
  orchestratorChannels,
  createInitialOrchestratorState,
} from "../schemas/orchestrator.schema";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "../prompts";

// ═══════════════════════════════════════════════════════════════
// NODE IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Router node - decides which tools to call or whether to respond directly
 */
async function routerNode(
  state: OrchestratorState
): Promise<Partial<OrchestratorState>> {
  const tools = getOrchestratorTools();
  const router = createRouterAgent(tools, {
    currentDate: state.currentDate,
  });

  // Build the message for the router
  const systemPrompt = ORCHESTRATOR_SYSTEM_PROMPT.replace(
    /{{currentDate}}/g,
    state.currentDate
  );

  // Use rewritten query if available, otherwise original
  const currentQuery = state.rewrittenQuery || state.userMessage || "";

  // Build context string
  const contextParts: string[] = [];
  if (state.conversationHistory) {
    contextParts.push(`Previous conversation:\n${state.conversationHistory}`);
  }
  if (state.memoryContext && state.memoryContext !== "No relevant memory found.") {
    contextParts.push(`Relevant memory context:\n${state.memoryContext}`);
  }

  const contextString = contextParts.length > 0 
    ? contextParts.join("\n\n") + "\n\n"
    : "";

  const userContent = `${contextString}User: ${currentQuery}`;

  try {
    const response = await router.llmWithTools.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userContent),
    ]);

    // Check if the response contains tool calls
    if (hasToolCalls(response)) {
      const toolCalls = extractToolCalls(response);
      console.log(`[routerNode] Tool calls detected: ${toolCalls.map(t => t.name).join(", ")}`);

      return {
        messages: [response as BaseMessage],
        toolCalls,
        nextRoute: "toolExecutor",
        iterationCount: state.iterationCount + 1,
      };
    } else {
      // No tools needed - extract direct response
      const content = typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content.map((c: { text?: string }) => c.text || c).join("")
          : "";

      console.log("[routerNode] Direct response (no tools needed)");

      return {
        messages: [response as BaseMessage],
        agentResponse: content,
        nextRoute: "saveMessages",
        iterationCount: state.iterationCount + 1,
      };
    }
  } catch (error) {
    handleAgentError(error, {
      agentType: "orchestrator",
      userId: state.userId,
      action: "router",
    });

    return {
      agentResponse: "I apologize, but I encountered an error processing your request. Please try again.",
      nextRoute: "saveMessages",
    };
  }
}

/**
 * Tool executor node - executes the tools selected by the router
 */
async function toolExecutorNode(
  state: OrchestratorState
): Promise<Partial<OrchestratorState>> {
  if (!state.toolCalls || state.toolCalls.length === 0) {
    return { nextRoute: "synthesize" };
  }

  const toolResults: Array<{
    toolName: string;
    toolCallId: string;
    result: string;
    success: boolean;
    error?: string;
  }> = [];

  const toolsUsed: string[] = [];

  // Execute each tool call
  for (const call of state.toolCalls) {
    try {
      console.log(`[toolExecutorNode] Executing tool: ${call.name}`);
      
      let result: string;

      // Route to the appropriate tool
      switch (call.name) {
        case "memory_search":
          result = await memorySearchTool.invoke({
            userId: call.args.userId || state.userId,
            query: call.args.query || state.userMessage,
          });
          break;

        case "supabase_store": {
          const raw = await supabaseStoreTool.invoke(call.args as Parameters<typeof supabaseStoreTool.invoke>[0]);
          result = typeof raw === "string" ? raw : JSON.stringify(raw);
          break;
        }

        case "embedding_generator":
          const embeddingResult = await embeddingGeneratorTool.invoke(call.args as Parameters<typeof embeddingGeneratorTool.invoke>[0]);
          result = typeof embeddingResult === "string" ? embeddingResult : JSON.stringify(embeddingResult);
          break;

        default:
          // Try to find the tool in the registry
          const tools = getOrchestratorTools();
          const tool = tools.find(t => t.name === call.name);
          if (tool) {
            result = await tool.invoke(call.args as Parameters<typeof tool.invoke>[0]);
          } else {
            result = JSON.stringify({ error: `Unknown tool: ${call.name}` });
          }
      }

      toolResults.push({
        toolName: call.name,
        toolCallId: call.id,
        result,
        success: true,
      });
      toolsUsed.push(call.name);

    } catch (error) {
      console.error(`[toolExecutorNode] Error executing ${call.name}:`, error);
      toolResults.push({
        toolName: call.name,
        toolCallId: call.id,
        result: JSON.stringify({ error: String(error) }),
        success: false,
        error: String(error),
      });
    }
  }

  // Build memory context from results
  let memoryContext = "";
  const memoryResults = toolResults.filter(r => r.toolName === "memory_search" && r.success);
  
  if (memoryResults.length > 0) {
    const parsedResults = memoryResults.map(r => {
      try {
        return JSON.parse(r.result);
      } catch {
        return { results: [], total_found: 0 };
      }
    });
    memoryContext = buildMemoryContext(parsedResults);
  }

  // Create tool messages for the conversation
  const toolMessages = toolResults.map(r => 
    new ToolMessage({
      content: r.result,
      tool_call_id: r.toolCallId,
    })
  );

  return {
    toolResults,
    toolsUsed,
    memoryContext: memoryContext || state.memoryContext,
    retrievedContext: memoryContext || state.retrievedContext,
    messages: toolMessages,
    nextRoute: "gradeDocuments",
  };
}

/**
 * Grade documents node wrapper
 */
async function gradeDocsNode(
  state: OrchestratorState
): Promise<Partial<OrchestratorState>> {
  // Use the existing gradeDocumentsNode function
  const result = await gradeDocumentsNode({
    userMessage: state.userMessage,
    retrievedContext: state.retrievedContext,
    memoryContext: state.memoryContext,
  });

  const routeDecision = routeAfterGrading({
    gradingResult: result.gradingResult,
    rewriteCount: state.rewriteCount,
  });

  return {
    gradingResult: result.gradingResult,
    gradingReasoning: result.gradingReasoning,
    nextRoute: routeDecision === "synthesize" ? "synthesize" : "rewriteQuery",
  };
}

/**
 * Rewrite query node wrapper
 */
async function rewriteNode(
  state: OrchestratorState
): Promise<Partial<OrchestratorState>> {
  const result = await rewriteQueryNode({
    userMessage: state.userMessage,
    originalQuery: state.originalQuery,
    rewriteCount: state.rewriteCount,
  });

  return {
    rewrittenQuery: result.rewrittenQuery,
    rewriteCount: result.rewriteCount,
    // Clear previous retrieval results for retry
    toolCalls: undefined,
    toolResults: undefined,
    memoryContext: undefined,
    retrievedContext: undefined,
    gradingResult: undefined,
    nextRoute: "router",
  };
}

/**
 * Synthesize response node - generates final response using retrieved context
 */
async function synthesizeNode(
  state: OrchestratorState
): Promise<Partial<OrchestratorState>> {
  const llm = createLLM({
    provider: (process.env.LLM_PROVIDER as string) || "anthropic",
    temperature: 0.7,
  });

  const systemPrompt = ORCHESTRATOR_SYSTEM_PROMPT.replace(
    /{{currentDate}}/g,
    state.currentDate
  );

  // Build context for synthesis
  const contextParts: string[] = [];
  
  if (state.conversationHistory) {
    contextParts.push(`Previous conversation:\n${state.conversationHistory}`);
  }
  
  if (state.memoryContext && state.memoryContext !== "No relevant memory found.") {
    contextParts.push(`Retrieved memory context:\n${state.memoryContext}`);
  } else if (state.retrievedContext) {
    contextParts.push(`Retrieved context:\n${state.retrievedContext}`);
  }

  const contextString = contextParts.length > 0
    ? contextParts.join("\n\n") + "\n\n"
    : "";

  const userContent = `${contextString}User question: ${state.userMessage}\n\nProvide a helpful response based on the available context. If no relevant context was found, acknowledge this and offer to help in other ways.`;

  try {
    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userContent),
    ]);

    const content = typeof response.content === "string"
      ? response.content
      : Array.isArray(response.content)
        ? response.content.map((c: { text?: string }) => c.text || c).join("")
        : "";

    return {
      agentResponse: content,
      nextRoute: "saveMessages",
    };
  } catch (error) {
    handleAgentError(error, {
      agentType: "orchestrator",
      userId: state.userId,
      action: "synthesize",
    });

    return {
      agentResponse: "I apologize, but I encountered an error generating a response. Please try again.",
      nextRoute: "saveMessages",
    };
  }
}

/**
 * Save messages node - persists conversation to database
 */
async function saveMessagesNode(
  state: OrchestratorState
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
        console.error("[saveMessagesNode] Error storing user message embedding:", e);
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
        console.error("[saveMessagesNode] Error storing assistant message embedding:", e);
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
 * Main routing function for conditional edges
 */
function routeOrchestrator(state: OrchestratorState): string {
  // Check for max iterations to prevent infinite loops
  if (state.iterationCount >= state.maxIterations) {
    console.warn("[routeOrchestrator] Max iterations reached, forcing synthesize");
    return "synthesize";
  }

  // Use nextRoute if set by a node
  if (state.nextRoute) {
    const route = state.nextRoute;
    // Map route decisions to node names
    switch (route) {
      case "toolExecutor":
        return "toolExecutor";
      case "gradeDocuments":
        return "gradeDocuments";
      case "rewriteQuery":
        return "rewriteQuery";
      case "synthesize":
        return "synthesize";
      case "saveMessages":
        return "saveMessages";
      case "router":
        return "router";
      case "end":
        return END;
      default:
        return "synthesize";
    }
  }

  return "synthesize";
}

// ═══════════════════════════════════════════════════════════════
// GRAPH CONSTRUCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Create the agentic orchestrator graph
 */
export function createOrchestratorGraph() {
  const workflow = new StateGraph<OrchestratorState>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LangGraph channels type
    channels: orchestratorChannels as any,
  })
    // Add nodes
    .addNode("router", routerNode)
    .addNode("toolExecutor", toolExecutorNode)
    .addNode("gradeDocuments", gradeDocsNode)
    .addNode("rewriteQuery", rewriteNode)
    .addNode("synthesize", synthesizeNode)
    .addNode("saveMessages", saveMessagesNode)

    // Define edges
    .addEdge(START, "router")
    .addConditionalEdges("router", routeOrchestrator, {
      toolExecutor: "toolExecutor",
      synthesize: "synthesize",
      saveMessages: "saveMessages",
      [END]: END,
    })
    .addConditionalEdges("toolExecutor", routeOrchestrator, {
      gradeDocuments: "gradeDocuments",
      synthesize: "synthesize",
    })
    .addConditionalEdges("gradeDocuments", routeOrchestrator, {
      synthesize: "synthesize",
      rewriteQuery: "rewriteQuery",
    })
    .addConditionalEdges("rewriteQuery", routeOrchestrator, {
      router: "router",
    })
    .addEdge("synthesize", "saveMessages")
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
 * Process a message through the orchestrator
 */
export async function processOrchestratorMessage(
  input: {
    userId: string;
    threadId: string;
    userMessage: string;
    currentDate?: string;
    userEmail?: string;
    conversationHistory?: string;
  }
): Promise<OrchestratorMessageResult> {
  const graph = createOrchestratorGraph();
  const initialState = createInitialOrchestratorState(input);

  const result = await graph.invoke(initialState);

  return {
    agentResponse: result.agentResponse || "I apologize, but I couldn't generate a response.",
    userMessageId: result.userMessageId,
    assistantMessageId: result.assistantMessageId,
    toolsUsed: result.toolsUsed,
    rewriteCount: result.rewriteCount,
  };
}

// Export for testing
export {
  routerNode,
  toolExecutorNode,
  gradeDocsNode,
  rewriteNode,
  synthesizeNode,
  saveMessagesNode,
  routeOrchestrator,
};
