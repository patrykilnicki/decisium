/**
 * Todo Triage Agent — LangGraph map-reduce pipeline for signal → task extraction.
 *
 * Two-phase pipeline:
 *   1. Extract: signals split into batches, each processed in parallel via Send.
 *   2. Verify: batches that yielded 0 tasks are re-examined with a "second opinion"
 *      prompt to catch missed actionable signals.
 *
 * Graph: START → fanOutBatches → extractBatch (‖) → fanOutVerify → verifyBatch (‖) → finalize → END
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
  enrichGmailItemsWithSourceUrl,
} from "./todo-generator";

const BATCH_SIZE = 7;

// ═══════════════════════════════════════════════════════════════
// VERIFICATION PROMPT
// ═══════════════════════════════════════════════════════════════

const VERIFY_EXTRACTION_PROMPT = `You are a second-opinion reviewer for a personal task extraction system.

TARGET DATE: {{targetDate}}

A previous analysis of these integration signals found NO actionable tasks.
Your job: review every signal below and determine if any were incorrectly skipped.

For EACH signal, briefly state:
1. Whether the user needs to take a concrete action (reply, prepare, review, decide, deliver, follow up).
2. Why or why not (one sentence).

If a signal IS actionable, include a task for it. Even borderline signals where the user *might* need to act should produce a task — it is better to surface a low-confidence task than to miss a real one.

Signals that are clearly automated notifications (CI bots, marketing, newsletters with no personal request) can be skipped.
For email threads: read the Content in full. If the LAST message in the thread is from the user (the account owner / recipient), do NOT create a reply or follow-up task for that thread. Create at most ONE task per thread (one per conversation).

Always output all generated text (title, summary, suggestedNextAction, etc.) in English.

Return a JSON array of tasks. Each object:
{
  "title": "short actionable title in English (max 80 chars)",
  "summary": "one sentence in English explaining what needs to be done",
  "priority": "normal" or "urgent",
  "urgentReason": "only when urgent — concrete fact from the signal, max ~80 chars. Omit for normal.",
  "sourceProvider": "google_calendar" or "gmail",
  "sourceType": "calendar_event" or "message",
  "sourceExternalId": "ID from the source signal",
  "actionabilityEvidence": "short quote or fact in English proving user action is required",
  "confidence": 0.0 to 1.0,
  "suggestedNextAction": "concrete next step in English the user should take",
  "tags": ["relevant", "tags"]
}

Return ONLY the JSON array. Return [] only when every signal is genuinely non-actionable.`;

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

interface BatchSignalGroup {
  batchIndex: number;
  signals: IntegrationSignal[];
}

interface BatchExtractionLog {
  batchIndex: number;
  signalCount: number;
  parsedCount: number;
  filteredCount: number;
  rawResponsePreview: string;
  isVerification: boolean;
}

const TriageState = Annotation.Root({
  date: Annotation<string>,
  allSignals: Annotation<IntegrationSignal[]>,
  existingItemKeys: Annotation<string[]>,
  /** When set, full system prompt (with preferences + date). Otherwise use TASK_EXTRACTION_PROMPT. */
  systemPromptTemplate: Annotation<string | undefined>,

  batchSignalGroups: Annotation<BatchSignalGroup[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
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

// ═══════════════════════════════════════════════════════════════
// SHARED LLM EXTRACTION HELPER
// ═══════════════════════════════════════════════════════════════

async function invokeLlmForTasks(
  batchSignals: IntegrationSignal[],
  date: string,
  batchIndex: number,
  systemPromptTemplate: string,
  isVerification: boolean,
): Promise<Partial<typeof TriageState.State>> {
  const llm = createLLM({ temperature: 0.15, maxTokens: 8192 });
  const systemPrompt = systemPromptTemplate.includes("{{targetDate}}")
    ? systemPromptTemplate.replace(/\{\{targetDate\}\}/g, date)
    : systemPromptTemplate;
  const context = signalsToPromptContext(batchSignals);
  const userContent = `Extract tasks for ${date} from these integration signals:\n\n${context}`;
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userContent },
  ];

  const makeLog = (
    parsedCount: number,
    filteredCount: number,
    preview: string,
  ): BatchExtractionLog => ({
    batchIndex,
    signalCount: batchSignals.length,
    parsedCount,
    filteredCount,
    rawResponsePreview: preview,
    isVerification,
  });

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
          makeLog(
            parsed.length,
            items.length,
            JSON.stringify(parsed).slice(0, 4_000),
          ),
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
        `[todo-triage] Batch ${batchIndex}${isVerification ? " (verify)" : ""}: structured output failed, using fallback:`,
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
        errors: [
          `Batch ${batchIndex}${isVerification ? " (verify)" : ""}: LLM returned no JSON array`,
        ],
        extractionLogs: [makeLog(0, 0, rawText.slice(0, 2_000))],
      };
    }
    const parsed = JSON.parse(jsonStr) as LlmExtractedTask[];
    if (!Array.isArray(parsed)) {
      return {
        errors: [
          `Batch ${batchIndex}${isVerification ? " (verify)" : ""}: parsed result is not an array`,
        ],
        extractionLogs: [makeLog(0, 0, jsonStr.slice(0, 2_000))],
      };
    }
    const items = processParsedTasksToItems(parsed, date, batchSignals);
    return {
      batchedTasks: items,
      extractionLogs: [
        makeLog(parsed.length, items.length, jsonStr.slice(0, 4_000)),
      ],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[todo-triage] Batch ${batchIndex}${isVerification ? " (verify)" : ""} failed:`,
      msg,
    );
    return {
      errors: [
        `Batch ${batchIndex}${isVerification ? " (verify)" : ""}: ${msg}`,
      ],
      extractionLogs: [makeLog(0, 0, "")],
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// NODES
// ═══════════════════════════════════════════════════════════════

/**
 * Fan-out: split signals into batches and dispatch via Send.
 */
function fanOutBatches(state: typeof TriageState.State): Send[] | string {
  const { allSignals, date, systemPromptTemplate } = state;
  if (!allSignals || allSignals.length === 0) return "finalize";

  const sends: Send[] = [];
  for (let i = 0; i < allSignals.length; i += BATCH_SIZE) {
    const batch = allSignals.slice(i, i + BATCH_SIZE);
    sends.push(
      new Send("extractBatch", {
        batchSignals: batch,
        batchIndex: Math.floor(i / BATCH_SIZE),
        date,
        systemPromptTemplate,
      }),
    );
  }
  return sends;
}

/**
 * Worker node: extract tasks from a single batch of signals.
 */
async function extractBatch(state: {
  batchSignals: IntegrationSignal[];
  batchIndex: number;
  date: string;
  systemPromptTemplate?: string;
}): Promise<Partial<typeof TriageState.State>> {
  const { batchSignals, batchIndex, date, systemPromptTemplate } = state;
  const prompt =
    systemPromptTemplate ??
    TASK_EXTRACTION_PROMPT.replace(/\{\{targetDate\}\}/g, date);

  const result = await invokeLlmForTasks(
    batchSignals,
    date,
    batchIndex,
    prompt,
    false,
  );

  return {
    ...result,
    batchSignalGroups: [{ batchIndex, signals: batchSignals }],
  };
}

/**
 * Conditional edge: after all extractBatch runs complete, check for batches
 * that produced 0 tasks and re-examine them via verifyBatch.
 */
function fanOutVerify(state: typeof TriageState.State): Send[] | string {
  const logs = state.extractionLogs ?? [];
  const groups = state.batchSignalGroups ?? [];

  const zeroBatchIndices = new Set(
    logs
      .filter((l) => !l.isVerification && l.parsedCount === 0)
      .map((l) => l.batchIndex),
  );

  if (zeroBatchIndices.size === 0) return "finalize";

  const sends: Send[] = [];
  for (const group of groups) {
    if (!zeroBatchIndices.has(group.batchIndex)) continue;
    sends.push(
      new Send("verifyBatch", {
        batchSignals: group.signals,
        batchIndex: group.batchIndex,
        date: state.date,
        systemPromptTemplate: state.systemPromptTemplate,
      }),
    );
  }

  return sends.length > 0 ? sends : "finalize";
}

/**
 * Verification worker: re-examine signals with a second-opinion prompt.
 * When a custom systemPromptTemplate is provided (user preferences), extract just the
 * USER PREFERENCES block and prepend it to the VERIFY_EXTRACTION_PROMPT so the
 * second-opinion pass also respects user toggle settings.
 */
async function verifyBatch(state: {
  batchSignals: IntegrationSignal[];
  batchIndex: number;
  date: string;
  systemPromptTemplate?: string;
}): Promise<Partial<typeof TriageState.State>> {
  let verifyPrompt = VERIFY_EXTRACTION_PROMPT;
  if (state.systemPromptTemplate) {
    const prefEnd = state.systemPromptTemplate.indexOf(
      "\n\nYou are an intelligent task extraction",
    );
    if (prefEnd > 0) {
      const prefsBlock = state.systemPromptTemplate.slice(0, prefEnd);
      verifyPrompt = prefsBlock + "\n\n" + verifyPrompt;
    }
    const VERIFY_SKIP_LINE =
      "Signals that are clearly automated notifications (CI bots, marketing, newsletters with no personal request) can be skipped.";
    const hasNewsletterYes = state.systemPromptTemplate.includes(
      "Create tasks from newsletters and marketing: yes.",
    );
    const hasBotYes = state.systemPromptTemplate.includes(
      "Create tasks from automated/bot messages: yes.",
    );
    if (hasNewsletterYes && hasBotYes) {
      verifyPrompt = verifyPrompt.replace(VERIFY_SKIP_LINE, "");
    } else if (hasNewsletterYes) {
      verifyPrompt = verifyPrompt.replace(
        VERIFY_SKIP_LINE,
        "Signals that are clearly automated notifications (CI bots) can be skipped.",
      );
    } else if (hasBotYes) {
      verifyPrompt = verifyPrompt.replace(
        VERIFY_SKIP_LINE,
        "Signals that are clearly marketing or newsletters with no personal request can be skipped.",
      );
    }
  }
  return invokeLlmForTasks(
    state.batchSignals,
    state.date,
    state.batchIndex,
    verifyPrompt,
    true,
  );
}

/**
 * For Gmail items with threadId, keep at most one per thread (highest confidence).
 * Reduces duplicates when multiple messages from the same thread produce tasks.
 */
function oneTaskPerGmailThread(tasks: TodoItem[]): TodoItem[] {
  const byThread = new Map<string, TodoItem>();
  const nonGmail: TodoItem[] = [];
  for (const item of tasks) {
    if (
      item.sourceProvider === "gmail" &&
      item.sourceType === "message" &&
      item.sourceRef?.threadId
    ) {
      const current = byThread.get(item.sourceRef.threadId);
      if (!current || (item.confidence ?? 0) > (current.confidence ?? 0)) {
        byThread.set(item.sourceRef.threadId, item);
      }
    } else {
      nonGmail.push(item);
    }
  }
  return [...nonGmail, ...byThread.values()];
}

/**
 * Aggregate: cross-batch dedup and filter against existing snapshot items.
 * Gmail: one task per thread (best by confidence), then dedup by keys.
 * Re-enrich with threadId from allSignals so dedup by thread works even when
 * the batch only contained a different message from the same thread.
 */
function finalize(state: typeof TriageState.State) {
  const { batchedTasks, existingItemKeys, allSignals } = state;
  if (!batchedTasks || batchedTasks.length === 0) {
    return { finalItems: [] };
  }

  const withThreadIds = enrichGmailItemsWithSourceUrl(
    batchedTasks,
    allSignals ?? [],
  );
  const onePerThread = oneTaskPerGmailThread(withThreadIds);
  const existingSet = new Set(existingItemKeys ?? []);
  const seenKeys = new Set<string>();
  const deduped: TodoItem[] = [];

  for (const item of onePerThread) {
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
    .addNode("extractBatch", extractBatch, {
      ends: ["verifyBatch", "finalize"],
    })
    .addNode("verifyBatch", verifyBatch, { ends: ["finalize"] })
    .addNode("finalize", finalize)
    .addConditionalEdges(START, fanOutBatches, {
      finalize: "finalize",
      extractBatch: "extractBatch",
    })
    .addConditionalEdges("extractBatch", fanOutVerify, {
      finalize: "finalize",
      verifyBatch: "verifyBatch",
    })
    .addEdge("verifyBatch", "finalize")
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
 * @param systemPromptTemplate - Optional full system prompt (with preferences + date). When omitted, TASK_EXTRACTION_PROMPT is used.
 */
export async function triageSignals(
  signals: IntegrationSignal[],
  date: string,
  existingItems?: TodoItem[],
  systemPromptTemplate?: string,
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
    systemPromptTemplate,
  });

  const logs = (result.extractionLogs ?? []).sort(
    (a, b) => a.batchIndex - b.batchIndex,
  );
  const batchCount = Math.ceil(signals.length / BATCH_SIZE);
  const totalParsed = logs.reduce((s, l) => s + l.parsedCount, 0);
  const totalFiltered = logs.reduce((s, l) => s + l.filteredCount, 0);
  const verifyCount = logs.filter((l) => l.isVerification).length;

  const systemPrompt =
    systemPromptTemplate ??
    TASK_EXTRACTION_PROMPT.replace(/\{\{targetDate\}\}/g, date);
  const rawResponsePreview = logs
    .map(
      (l) =>
        `[batch ${l.batchIndex}${l.isVerification ? " VERIFY" : ""}] ${l.rawResponsePreview}`,
    )
    .join("\n---\n")
    .slice(0, 50_000);

  const extractionLog: TodoExtractionLog = {
    systemPrompt,
    userContent: `[${batchCount} batches of ~${BATCH_SIZE} signals, ${verifyCount} verified]`,
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
