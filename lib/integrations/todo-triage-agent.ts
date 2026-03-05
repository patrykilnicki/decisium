/**
 * Todo Triage Agent — LangGraph map-reduce pipeline for signal → task extraction.
 *
 * Uses the Send API for parallel batch processing: signals are split into groups
 * of ~BATCH_SIZE, each batch is processed independently by the LLM, and results
 * are aggregated via reducer. This eliminates the context-truncation problem of
 * a single monolithic LLM call.
 */
import { Annotation, Send, StateGraph, START, END } from "@langchain/langgraph";
import { createLLM } from "@/packages/agents/lib/llm";
import type { TodoItem } from "@/packages/agents/schemas/todo.schema";
import {
  TASK_EXTRACTION_PROMPT,
  LlmExtractedTaskArraySchema,
  type LlmExtractedTask,
  type TodoExtractionLog,
  type IntegrationSignal,
  signalsToPromptContext,
  processParsedTasksToItems,
  buildTodoItemDedupKeys,
  extractJsonArrayFromResponse,
} from "./todo-generator";

const BATCH_SIZE = 10;

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

const TriageState = Annotation.Root({
  date: Annotation<string>,
  allSignals: Annotation<IntegrationSignal[]>,
  existingItemKeys: Annotation<string[]>,

  batchedTasks: Annotation<TodoItem[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  extractionLogs: Annotation<BatchExtractionLog[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  errors: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  finalItems: Annotation<TodoItem[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
});

interface BatchExtractionLog {
  batchIndex: number;
  signalCount: number;
  parsedCount: number;
  filteredCount: number;
  rawResponsePreview: string;
}

// ═══════════════════════════════════════════════════════════════
// NODES
// ═══════════════════════════════════════════════════════════════

/**
 * Fan-out: split signals into batches and dispatch via Send.
 * Returns Send objects (one per batch) for parallel execution, or routes
 * directly to finalize when there are no signals.
 */
function fanOutBatches(state: typeof TriageState.State): Send[] | string {
  const { allSignals, date } = state;
  if (!allSignals || allSignals.length === 0) {
    return "finalize";
  }

  const sends: Send[] = [];
  for (let i = 0; i < allSignals.length; i += BATCH_SIZE) {
    const batch = allSignals.slice(i, i + BATCH_SIZE);
    sends.push(
      new Send("extractBatch", {
        batchSignals: batch,
        batchIndex: Math.floor(i / BATCH_SIZE),
        date,
      }),
    );
  }
  return sends;
}

/**
 * Worker node: extract tasks from a single batch of signals.
 * Each invocation runs independently (potentially in parallel via Send).
 */
async function extractBatch(state: {
  batchSignals: IntegrationSignal[];
  batchIndex: number;
  date: string;
}): Promise<Partial<typeof TriageState.State>> {
  const { batchSignals, batchIndex, date } = state;

  const llm = createLLM({ temperature: 0.15, maxTokens: 8192 });
  const systemPrompt = TASK_EXTRACTION_PROMPT.replace(
    /\{\{targetDate\}\}/g,
    date,
  );
  const context = signalsToPromptContext(batchSignals);
  const userContent = `Extract tasks for ${date} from these integration signals:\n\n${context}`;
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userContent },
  ];

  // 1. Try structured output
  try {
    const structuredLlm = llm.withStructuredOutput(
      LlmExtractedTaskArraySchema,
      { name: "todo_tasks", strict: true, method: "jsonSchema" },
    );
    const parsed = await structuredLlm.invoke(messages);
    if (Array.isArray(parsed)) {
      const items = processParsedTasksToItems(
        parsed as LlmExtractedTask[],
        date,
        batchSignals,
      );
      return {
        batchedTasks: items,
        extractionLogs: [
          {
            batchIndex,
            signalCount: batchSignals.length,
            parsedCount: parsed.length,
            filteredCount: items.length,
            rawResponsePreview: JSON.stringify(parsed).slice(0, 4_000),
          },
        ],
      };
    }
  } catch (structuredErr) {
    const msg =
      structuredErr instanceof Error
        ? structuredErr.message
        : String(structuredErr);
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[todo-triage] Batch ${batchIndex}: structured output failed, using fallback:`,
        msg,
      );
    }
  }

  // 2. Fallback: raw invoke + JSON extraction
  try {
    const response = await llm.invoke(messages);
    const rawText =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .map((c) =>
                typeof c === "string"
                  ? c
                  : ((c as { text?: string }).text ?? ""),
              )
              .join("")
          : "";
    const jsonStr = extractJsonArrayFromResponse(rawText);
    if (!jsonStr) {
      return {
        errors: [`Batch ${batchIndex}: LLM returned no JSON array`],
        extractionLogs: [
          {
            batchIndex,
            signalCount: batchSignals.length,
            parsedCount: 0,
            filteredCount: 0,
            rawResponsePreview: rawText.slice(0, 2_000),
          },
        ],
      };
    }
    const parsed = JSON.parse(jsonStr) as LlmExtractedTask[];
    if (!Array.isArray(parsed)) {
      return {
        errors: [`Batch ${batchIndex}: parsed result is not an array`],
        extractionLogs: [
          {
            batchIndex,
            signalCount: batchSignals.length,
            parsedCount: 0,
            filteredCount: 0,
            rawResponsePreview: jsonStr.slice(0, 2_000),
          },
        ],
      };
    }
    const items = processParsedTasksToItems(parsed, date, batchSignals);
    return {
      batchedTasks: items,
      extractionLogs: [
        {
          batchIndex,
          signalCount: batchSignals.length,
          parsedCount: parsed.length,
          filteredCount: items.length,
          rawResponsePreview: jsonStr.slice(0, 4_000),
        },
      ],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[todo-triage] Batch ${batchIndex} failed:`, msg);
    return {
      errors: [`Batch ${batchIndex}: ${msg}`],
      extractionLogs: [
        {
          batchIndex,
          signalCount: batchSignals.length,
          parsedCount: 0,
          filteredCount: 0,
          rawResponsePreview: "",
        },
      ],
    };
  }
}

/**
 * Aggregate: cross-batch dedup and filter against existing snapshot items.
 */
function finalize(state: typeof TriageState.State) {
  const { batchedTasks, existingItemKeys } = state;
  if (!batchedTasks || batchedTasks.length === 0) {
    return { finalItems: [] };
  }

  const existingSet = new Set(existingItemKeys ?? []);
  const seenKeys = new Set<string>();
  const deduped: TodoItem[] = [];

  for (const item of batchedTasks) {
    const keys = buildTodoItemDedupKeys(item);
    if (keys.length === 0) continue;
    if (keys.some((k) => existingSet.has(k))) continue;
    if (keys.some((k) => seenKeys.has(k))) continue;
    for (const k of keys) seenKeys.add(k);
    deduped.push(item);
  }

  return { finalItems: deduped };
}

// ═══════════════════════════════════════════════════════════════
// GRAPH
// ═══════════════════════════════════════════════════════════════

function buildTriageGraph() {
  return new StateGraph(TriageState)
    .addNode("extractBatch", extractBatch, { ends: ["finalize"] })
    .addNode("finalize", finalize)
    .addConditionalEdges(START, fanOutBatches, {
      finalize: "finalize",
      extractBatch: "extractBatch",
    })
    .addEdge("extractBatch", "finalize")
    .addEdge("finalize", END)
    .compile();
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

export interface TriageResult {
  items: TodoItem[];
  extractionLog: TodoExtractionLog | null;
  batchCount: number;
  errors: string[];
}

/**
 * Process integration signals through the triage agent.
 * Drop-in replacement for the old extractTasksWithLlm.
 */
export async function triageSignals(
  signals: IntegrationSignal[],
  date: string,
  existingItems?: TodoItem[],
): Promise<TriageResult> {
  if (signals.length === 0) {
    return { items: [], extractionLog: null, batchCount: 0, errors: [] };
  }

  const existingItemKeys = (existingItems ?? []).flatMap((item) =>
    buildTodoItemDedupKeys(item),
  );

  const graph = buildTriageGraph();
  const result = await graph.invoke({
    date,
    allSignals: signals,
    existingItemKeys,
  });

  const logs = (result.extractionLogs ?? []).sort(
    (a, b) => a.batchIndex - b.batchIndex,
  );
  const batchCount = Math.ceil(signals.length / BATCH_SIZE);
  const totalParsed = logs.reduce((s, l) => s + l.parsedCount, 0);
  const totalFiltered = logs.reduce((s, l) => s + l.filteredCount, 0);

  const systemPrompt = TASK_EXTRACTION_PROMPT.replace(
    /\{\{targetDate\}\}/g,
    date,
  );
  const rawResponsePreview = logs
    .map((l) => `[batch ${l.batchIndex}] ${l.rawResponsePreview}`)
    .join("\n---\n")
    .slice(0, 50_000);

  const extractionLog: TodoExtractionLog = {
    systemPrompt,
    userContent: `[${batchCount} batches of ~${BATCH_SIZE} signals]`,
    rawResponse: rawResponsePreview,
    parsedCount: totalParsed,
    filteredCount: totalFiltered,
    extractedItemsForLog: (result.finalItems ?? []).map((i) => ({
      id: i.id,
      title: i.title,
      summary: i.summary,
      priority: i.priority,
      sourceProvider: i.sourceProvider,
      sourceType: i.sourceType,
      sourceExternalId: i.sourceRef?.externalId,
      confidence: i.confidence,
    })),
  };

  return {
    items: result.finalItems ?? [],
    extractionLog,
    batchCount,
    errors: result.errors ?? [],
  };
}
