export interface ErrorContext {
  agentType?: string;
  userId?: string;
  action?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Custom error class for agent errors with context
 */
export class AgentError extends Error {
  public readonly context?: ErrorContext;
  public readonly originalError?: Error;

  constructor(message: string, context?: ErrorContext, originalError?: Error) {
    super(message);
    this.name = "AgentError";
    this.context = context;
    this.originalError = originalError;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AgentError);
    }
  }
}

/**
 * Handle agent errors with logging and user-friendly messages
 */
export function handleAgentError(
  error: unknown,
  context?: ErrorContext,
): never {
  // Log error with context
  console.error("[Agent Error]", {
    message: error instanceof Error ? error.message : String(error),
    context,
    stack: error instanceof Error ? error.stack : undefined,
  });

  // If it's already an AgentError, re-throw it
  if (error instanceof AgentError) {
    throw error;
  }

  // If it's a known error, wrap it
  if (error instanceof Error) {
    // Check for recursion limit errors - provide helpful guidance
    if (
      error.message.includes("Recursion limit") ||
      error.message.includes("recursionLimit") ||
      error.name === "GraphRecursionError" ||
      error.name === "AgentRecursionLimitError"
    ) {
      throw new AgentError(
        "The agent encountered a complex request that required too many steps to complete. Please try simplifying your request or breaking it into smaller parts.",
        context,
        error,
      );
    }

    // Check for common error types
    if (error.message.includes("Unauthorized")) {
      throw new AgentError(
        "Authentication required. Please log in.",
        context,
        error,
      );
    }

    if (error.message.includes("not found")) {
      throw new AgentError(
        "The requested resource was not found.",
        context,
        error,
      );
    }

    if (error.message.includes("Failed to store")) {
      throw new AgentError(
        "Failed to save data. Please try again.",
        context,
        error,
      );
    }

    // Generic error wrapper
    throw new AgentError(
      error.message || "An unexpected error occurred.",
      context,
      error,
    );
  }

  // Unknown error type
  throw new AgentError(
    "An unexpected error occurred.",
    context,
    error instanceof Error ? error : new Error(String(error)),
  );
}

/**
 * Wrap async functions with error handling
 */
export function withErrorHandling<
  T extends (...args: unknown[]) => Promise<unknown>,
>(fn: T, context?: ErrorContext): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      handleAgentError(error, context);
    }
  }) as T;
}

/**
 * Create a safe async function that returns a result or error
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
  context?: ErrorContext,
): Promise<{ data?: T; error?: AgentError }> {
  try {
    const data = await fn();
    return { data };
  } catch (error) {
    const agentError =
      error instanceof AgentError
        ? error
        : new AgentError(
            error instanceof Error ? error.message : String(error),
            context,
            error instanceof Error ? error : undefined,
          );
    return { error: agentError };
  }
}
