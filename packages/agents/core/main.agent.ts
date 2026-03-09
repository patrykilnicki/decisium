import { createDeepAgent, type SubAgent } from "deepagents";
import { createLLM } from "../lib/llm";
import {
  getCurrentDate,
  getCurrentDateWithDay,
  getFormattedDateWithDay,
} from "../lib/date-utils";
import { handleAgentError } from "../lib/error-handler";
import { createSafeAgentInvoker } from "../lib/agent-invocation";
import { memorySearchTool } from "../tools";
import {
  MAIN_AGENT_SYSTEM_PROMPT,
  ASK_SUBAGENT_SYSTEM_PROMPT,
} from "../prompts";
import {
  type MainAgentInput,
  type MainAgentResult,
  formatContextForPrompt,
} from "../schemas/main.schema";

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

interface MainAgentConfig {
  model?: string;
  temperature?: number;
  /** When provided (e.g. from user context), used for "today" in prompts instead of UTC */
  currentDate?: string;
  /**
   * Recursion limit for agent invocations
   * Default: 100 (accommodates subagent routing and tool calls)
   */
  recursionLimit?: number;
}

// ═══════════════════════════════════════════════════════════════
// SUBAGENT DEFINITIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Ask subagent - handles complex questions, research, and pattern analysis
 * Note: Storage is handled by the calling code, subagents only read via memory_search
 */
function createAskSubagent(currentDate: string): SubAgent {
  const systemPrompt = ASK_SUBAGENT_SYSTEM_PROMPT.replace(
    /{{currentDate}}/g,
    currentDate,
  );

  return {
    name: "ask-agent",
    description:
      "Handles complex questions, research, pattern analysis, and in-depth conversations. " +
      "Use this agent when the user asks about their history, patterns, habits, or needs analysis. " +
      "Best for: questions about the past, trend analysis, reflection, multi-turn conversations.",
    systemPrompt,
    // Only memory search - storage is handled by calling code
    tools: [memorySearchTool],
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN AGENT FACTORY
// ═══════════════════════════════════════════════════════════════

/**
 * Create the main orchestrating agent with subagents
 * @returns A deepagent instance (typed as unknown to avoid deep type inference issues with LangChain)
 */
export function createMainAgent(config?: MainAgentConfig): unknown {
  const currentDate = config?.currentDate ?? getCurrentDate();
  const currentDateWithDay = config?.currentDate
    ? getFormattedDateWithDay(config.currentDate)
    : getCurrentDateWithDay();

  // Create the LLM (OpenRouter only)
  const llm = createLLM({
    model: config?.model,
    temperature: config?.temperature ?? 0.7,
  });

  // Build the system prompt with date
  const dateLayer = `Current Date: ${currentDateWithDay} (${currentDate})\n\n`;
  const systemPrompt =
    dateLayer +
    MAIN_AGENT_SYSTEM_PROMPT.replace(/{{currentDate}}/g, currentDate);

  // Create subagents
  const askSubagent = createAskSubagent(currentDate);

  // Create the main agent with subagents
  // Note: Storage tools are removed - storage is handled by calling code
  return createDeepAgent({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deepagents expects LangChain model type
    model: llm as any,
    systemPrompt,
    subagents: [askSubagent],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deepagents expects LangChain tools type
    tools: [memorySearchTool] as any,
  });
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

/**
 * Process a message through the main agent
 * Routes to appropriate subagent based on context and intent
 */
export async function processMainAgentMessage(
  input: MainAgentInput,
  config?: MainAgentConfig,
): Promise<MainAgentResult> {
  try {
    const agent = createMainAgent({
      ...config,
      currentDate: config?.currentDate ?? input.context?.currentDate,
    });

    // Format the context for the agent
    const contextInfo = formatContextForPrompt(input.context);

    // Build the message with context
    const messageWithContext = `
Context:
${contextInfo}

User message: ${input.userMessage}
`.trim();

    // Raw invoke result has messages; we then map to MainAgentResult
    type InvokeResult = {
      messages?: Array<{ content?: string | Array<{ text?: string }> }>;
    };
    const safeInvoke = createSafeAgentInvoker<InvokeResult>(
      agent as {
        invoke: (
          input: unknown,
          config?: { recursionLimit?: number },
        ) => Promise<InvokeResult>;
      },
      {
        recursionLimit: config?.recursionLimit ?? 100,
        extractPartialOnLimit: true,
      },
    );

    const invocationResult = await safeInvoke({
      messages: [
        {
          role: "user",
          content: messageWithContext,
        },
      ],
    });

    const result = invocationResult.data;

    // Extract the response
    const lastMessage = result.messages?.[result.messages.length - 1];
    let agentResponse = "";

    if (lastMessage?.content) {
      if (typeof lastMessage.content === "string") {
        agentResponse = lastMessage.content;
      } else if (Array.isArray(lastMessage.content)) {
        agentResponse = lastMessage.content
          .map((block: { text?: string } | string) =>
            typeof block === "string" ? block : block?.text || "",
          )
          .join("");
      }
    }

    // If we got a partial result, append a warning
    if (invocationResult.partial && invocationResult.warning) {
      agentResponse = `${agentResponse}\n\n_Note: ${invocationResult.warning}_`;
    }

    // Determine which agent handled the request
    // (We could enhance this by tracking subagent calls)
    const handledBy = "main" as const;

    return {
      agentResponse,
      handledBy,
    };
  } catch (error) {
    handleAgentError(error, {
      agentType: "main",
      userId: input.context.userId,
      action: "process_message",
    });

    // This won't be reached due to handleAgentError throwing, but TypeScript needs it
    throw error;
  }
}

/**
 * Process an ask page message
 * Convenience wrapper that sets up ask context
 */
export async function processAskPageMessage(params: {
  userId: string;
  threadId: string;
  userMessage: string;
  currentDate?: string;
  userEmail?: string;
  conversationHistory?: string;
}): Promise<MainAgentResult> {
  const currentDate = params.currentDate || getCurrentDate();

  return processMainAgentMessage({
    userMessage: params.userMessage,
    context: {
      page: "ask",
      userId: params.userId,
      threadId: params.threadId,
      currentDate,
      userEmail: params.userEmail,
      conversationHistory: params.conversationHistory,
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export type { MainAgentConfig };
