import { z } from "zod";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createLLM } from "../lib/llm";
import { GRADE_DOCUMENTS_PROMPT } from "../prompts";
import { logLlmUsage } from "../lib/llm-usage";

/**
 * Schema for document grading result
 */
export const GradeDocumentsSchema = z.object({
  binaryScore: z
    .enum(["yes", "no"])
    .describe(
      "Relevance score: 'yes' if documents are relevant to the question, 'no' otherwise",
    ),
  reasoning: z
    .string()
    .optional()
    .describe("Brief explanation for the grading decision"),
});

export type GradeDocumentsResult = z.infer<typeof GradeDocumentsSchema>;

/**
 * Grading prompt template (loaded from prompts/grade-documents.md)
 */
const GRADE_PROMPT = ChatPromptTemplate.fromTemplate(GRADE_DOCUMENTS_PROMPT);

export interface GradeDocumentsConfig {
  llmProvider?: "openai" | "anthropic" | "openrouter";
  model?: string;
  temperature?: number;
  userId?: string;
}

/**
 * Create a document grader with structured output
 */
export function createDocumentGrader(config?: GradeDocumentsConfig) {
  const provider =
    config?.llmProvider ||
    (process.env.LLM_PROVIDER as "openai" | "anthropic" | "openrouter") ||
    "anthropic";

  const llm = createLLM({
    provider,
    model: config?.model,
    temperature: config?.temperature ?? 0.1, // Low temperature for consistent grading
  });

  // Use withStructuredOutput for reliable schema-based responses
  const graderLLM = llm.withStructuredOutput(GradeDocumentsSchema);

  return {
    llm: graderLLM,
    prompt: GRADE_PROMPT,
  };
}

/**
 * Grade documents for relevance to a question
 * Returns the grading result with decision for routing
 */
export async function gradeDocuments(
  question: string,
  context: string,
  config?: GradeDocumentsConfig,
): Promise<{
  grade: GradeDocumentsResult;
  routeDecision: "generate" | "rewrite";
}> {
  const grader = createDocumentGrader(config);

  const formattedPrompt = await GRADE_PROMPT.format({
    question,
    context,
  });

  const grade = await grader.llm.invoke(formattedPrompt);
  await logLlmUsage({
    response: grade,
    userId: config?.userId,
    agentType: "orchestrator_grade_documents",
    nodeKey: "grade_documents",
    taskType: "orchestrator.grade_documents",
  });

  return {
    grade,
    routeDecision: grade.binaryScore === "yes" ? "generate" : "rewrite",
  };
}

/**
 * Node function for LangGraph integration
 * Accepts state and returns partial state update
 */
export async function gradeDocumentsNode<
  TState extends {
    userMessage?: string;
    messages?: Array<{ content: string }>;
    retrievedContext?: string;
    memoryContext?: string;
    userId?: string;
  },
>(
  state: TState,
  config?: GradeDocumentsConfig,
): Promise<{
  gradingResult: "relevant" | "irrelevant";
  gradingReasoning?: string;
}> {
  // Extract question from state
  const question =
    state.userMessage || state.messages?.find((m) => m.content)?.content || "";

  // Extract context from state
  const context = state.retrievedContext || state.memoryContext || "";

  // If no context was retrieved, mark as irrelevant
  if (!context || context === "No relevant memory found.") {
    return {
      gradingResult: "irrelevant",
      gradingReasoning: "No documents were retrieved to grade",
    };
  }

  // If no question, cannot grade
  if (!question) {
    return {
      gradingResult: "irrelevant",
      gradingReasoning: "No question provided for grading",
    };
  }

  try {
    const { grade, routeDecision } = await gradeDocuments(question, context, {
      ...config,
      userId: state.userId ?? config?.userId,
    });

    return {
      gradingResult: routeDecision === "generate" ? "relevant" : "irrelevant",
      gradingReasoning: grade.reasoning,
    };
  } catch (error) {
    console.error("[gradeDocumentsNode] Error during grading:", error);
    // On error, default to using the context (relevant)
    return {
      gradingResult: "relevant",
      gradingReasoning: "Grading failed, defaulting to relevant",
    };
  }
}

/**
 * Routing function for conditional edges
 * Returns the next node name based on grading result
 */
export function routeAfterGrading(state: {
  gradingResult?: "relevant" | "irrelevant";
  rewriteCount?: number;
}): "synthesize" | "rewrite" {
  const maxRewrites = 2;
  const currentRewrites = state.rewriteCount || 0;

  // If already rewritten max times, proceed to generate anyway
  if (currentRewrites >= maxRewrites) {
    return "synthesize";
  }

  // Route based on grading result
  if (state.gradingResult === "relevant") {
    return "synthesize";
  }

  return "rewrite";
}
