/**
 * Safe agent invocation utilities with recursion limit handling
 * Based on LangGraph best practices for handling recursion limits
 */

import type { AgentError } from "./error-handler";

export interface AgentInvocationConfig {
  /**
   * Maximum recursion limit for the agent invocation
   * Default: 100 (higher than default 25 to accommodate subagents)
   */
  recursionLimit?: number;
  
  /**
   * Whether to attempt extracting partial results when recursion limit is hit
   * Default: true
   */
  extractPartialOnLimit?: boolean;
  
  /**
   * Timeout in milliseconds (optional)
   * If set, will abort the invocation after this time
   */
  timeout?: number;
}

export interface AgentInvocationResult<T> {
  data: T;
  partial?: boolean;
  warning?: string;
}

/**
 * Check if an error is a recursion limit error
 */
function isRecursionLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  
  // Check error name (for GraphRecursionError from LangGraph)
  if (error.name === "GraphRecursionError") return true;
  
  // Check error message patterns
  const message = error.message.toLowerCase();
  return (
    message.includes("recursion limit") ||
    message.includes("recursionlimit") ||
    message.includes("maximum number of steps") ||
    message.includes("without hitting a stop condition")
  );
}

/**
 * Extract partial results from agent state when recursion limit is hit
 * This attempts to get the last meaningful message from the agent
 */
function extractPartialResult(result: any): string | null {
  try {
    // Try to get messages from the result
    const messages = result?.messages || result?.state?.messages || [];
    
    if (Array.isArray(messages) && messages.length > 0) {
      // Find the last assistant message
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        const content = msg?.content;
        
        if (content) {
          if (typeof content === "string" && content.trim().length > 0) {
            return content;
          }
          
          if (Array.isArray(content)) {
            const textContent = content
              .map((block: any) => {
                if (typeof block === "string") return block;
                if (block?.text) return block.text;
                if (block?.type === "text") return block.text;
                return "";
              })
              .join("")
              .trim();
            
            if (textContent.length > 0) {
              return textContent;
            }
          }
        }
      }
    }
    
    // Fallback: try to extract from state
    if (result?.state?.agentResponse) {
      return String(result.state.agentResponse);
    }
    
    return null;
  } catch (e) {
    console.warn("[Agent Invocation] Failed to extract partial result:", e);
    return null;
  }
}

/**
 * Safely invoke an agent with recursion limit handling
 * 
 * This function:
 * 1. Wraps the agent invocation with proper error handling
 * 2. Attempts to extract partial results if recursion limit is hit
 * 3. Provides graceful degradation instead of hard failures
 * 
 * @param agentInvocation - Function that invokes the agent
 * @param config - Configuration for the invocation
 * @returns Result with data and optional partial/warning flags
 */
export async function safeAgentInvoke<T extends { messages?: any[]; agentResponse?: string }>(
  agentInvocation: () => Promise<T>,
  config: AgentInvocationConfig = {}
): Promise<AgentInvocationResult<T>> {
  const {
    recursionLimit = 100,
    extractPartialOnLimit = true,
    timeout,
  } = config;

  try {
    // Create abort controller if timeout is set
    const abortController = timeout ? new AbortController() : undefined;
    const timeoutId = timeout
      ? setTimeout(() => abortController?.abort(), timeout)
      : undefined;

    try {
      const result = await agentInvocation();
      
      // Clear timeout if successful
      if (timeoutId) clearTimeout(timeoutId);
      
      return { data: result };
    } catch (invocationError) {
      // Clear timeout on error
      if (timeoutId) clearTimeout(timeoutId);
      
      // Check if it's a recursion limit error
      if (isRecursionLimitError(invocationError) && extractPartialOnLimit) {
        console.warn(
          `[Agent Invocation] Recursion limit (${recursionLimit}) reached. ` +
          `Error: ${invocationError instanceof Error ? invocationError.message : String(invocationError)}`
        );

        // Try to extract partial results from the error or last state
        // Note: LangGraph errors may contain state information in some cases
        const errorAny = invocationError as any;
        const partialResult = extractPartialResult(
          errorAny.state || 
          errorAny.result || 
          errorAny.lastState ||
          errorAny.checkpoint
        );

        if (partialResult && partialResult.length > 0) {
          console.info(
            `[Agent Invocation] Successfully extracted partial result (${partialResult.length} chars)`
          );
          
          // Create a partial result object
          const partialData = {
            messages: [
              {
                role: "assistant",
                content: partialResult,
              },
            ],
            agentResponse: partialResult,
          } as T;

          return {
            data: partialData,
            partial: true,
            warning: `Response was truncated due to complexity. The agent reached the maximum number of steps (${recursionLimit}) before completing.`,
          };
        } else {
          console.warn(
            `[Agent Invocation] Could not extract partial results from recursion error`
          );
        }
      }

      // Re-throw if we can't handle it
      throw invocationError;
    }
  } catch (error) {
    // If we still have an error, check if it's a timeout
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Agent invocation timed out after ${timeout}ms. The request may be too complex.`
      );
    }

    // Re-throw recursion limit errors with better message if we couldn't extract partial results
    if (isRecursionLimitError(error)) {
      const message = `The agent reached the maximum number of steps (${recursionLimit}) without completing. This may indicate an infinite loop or an overly complex request. Please try simplifying your request or breaking it into smaller parts.`;
      
      const enhancedError = new Error(message);
      enhancedError.name = "AgentRecursionLimitError";
      (enhancedError as any).originalError = error;
      throw enhancedError;
    }

    // Re-throw other errors as-is
    throw error;
  }
}

/**
 * Create a wrapper for agent.invoke with safe recursion limit handling
 */
export function createSafeAgentInvoker<T extends { messages?: any[]; agentResponse?: string }>(
  agent: { invoke: (input: any, config?: any) => Promise<T> },
  defaultConfig?: AgentInvocationConfig
) {
  return async (
    input: any,
    config?: AgentInvocationConfig
  ): Promise<AgentInvocationResult<T>> => {
    const mergedConfig = { ...defaultConfig, ...config };
    const recursionLimit = mergedConfig.recursionLimit ?? 100;

    return safeAgentInvoke(
      () => agent.invoke(input, { recursionLimit }),
      mergedConfig
    );
  };
}
