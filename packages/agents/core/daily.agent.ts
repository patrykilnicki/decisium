import { StateGraph, END, START } from "@langchain/langgraph";
import { createSimpleAgent } from "../lib/agent-base";
import {
  memorySearchTool,
  supabaseStoreTool,
  embeddingGeneratorTool,
} from "../tools";
import { getCurrentDate } from "../lib/date-utils";
import { buildMemoryContext } from "../lib/context";
import { handleAgentError } from "../lib/error-handler";
import { logLlmUsage } from "../lib/llm-usage";
import {
  getTodayMeetingsForUser,
  formatTodayMeetingsForContext,
} from "@/lib/calendar/today-meetings";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DailyEvent as SchemaDailyEvent } from "../schemas/daily.schema";
import {
  DAILY_WELCOME_SYSTEM_PROMPT,
  DAILY_CLASSIFIER_SYSTEM_PROMPT,
  DAILY_RESPONSE_SYSTEM_PROMPT,
} from "../prompts";

// Type Definitions
export type ClassificationResult =
  | "NOTE"
  | "QUESTION"
  | "NOTE_PLUS_QUESTION"
  | "ESCALATE_TO_ASK";

// Internal DailyEvent type with additional fields for graph state
export interface DailyEvent extends SchemaDailyEvent {
  subtype?: "welcome" | string;
  embedding?: number[];
}

export interface DailyGraphState {
  userId: string;
  currentDate: string;
  userMessage?: string;
  classification?: ClassificationResult;
  welcomeMessage?: string;
  memoryContext?: string;
  agentResponse?: string;
  eventsToSave?: DailyEvent[];
  dailyStarted?: boolean;
  shouldEnd?: boolean;
  userEventId?: string;
  agentEventId?: string;
}

export interface DailyWelcomeResult {
  welcomeMessage: string | null;
  alreadyStarted: boolean;
}

export interface DailyMessageResult {
  agentResponse: string | null;
  eventsSaved: boolean;
  classification: ClassificationResult;
}

// Agent Configurations

function createDailyWelcomeAgent(config?: {
  llmProvider?: "openai" | "anthropic" | "openrouter";
  model?: string;
  temperature?: number;
  currentDate?: string;
}): ReturnType<typeof createSimpleAgent> {
  return createSimpleAgent({
    systemPrompt: DAILY_WELCOME_SYSTEM_PROMPT,
    temperature: config?.temperature ?? 0.7,
    currentDate: config?.currentDate || getCurrentDate(),
    llmProvider: config?.llmProvider,
    model: config?.model,
  });
}

function createClassifierAgent(config?: {
  llmProvider?: "openai" | "anthropic" | "openrouter";
  model?: string;
  temperature?: number;
}): ReturnType<typeof createSimpleAgent> {
  return createSimpleAgent({
    systemPrompt: DAILY_CLASSIFIER_SYSTEM_PROMPT,
    temperature: config?.temperature ?? 0.1,
    llmProvider: config?.llmProvider,
    model: config?.model,
  });
}

function createDailyResponseAgent(config?: {
  llmProvider?: "openai" | "anthropic" | "openrouter";
  model?: string;
  temperature?: number;
  currentDate?: string;
}): ReturnType<typeof createSimpleAgent> {
  return createSimpleAgent({
    systemPrompt: DAILY_RESPONSE_SYSTEM_PROMPT,
    temperature: config?.temperature ?? 0.5,
    currentDate: config?.currentDate || getCurrentDate(),
    llmProvider: config?.llmProvider,
    model: config?.model,
  });
}

// Node Implementations

async function checkDailyStartedNode(
  state: DailyGraphState,
): Promise<Partial<DailyGraphState>> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("daily_events")
    .select("*")
    .eq("user_id", state.userId)
    .eq("date", state.currentDate)
    .eq("role", "agent")
    .eq("type", "system")
    .eq("subtype", "welcome")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error checking daily started:", error);
    return { dailyStarted: false };
  }

  if (data) {
    return { dailyStarted: true, shouldEnd: true };
  }

  return { dailyStarted: false };
}

async function dailyWelcomeAgentNode(
  state: DailyGraphState,
): Promise<Partial<DailyGraphState>> {
  const welcomeAgent = createDailyWelcomeAgent({
    currentDate: state.currentDate,
  });

  const result = await welcomeAgent.invoke(
    {
      messages: [
        {
          role: "user",
          content: "Generate a welcome message for today's daily check-in.",
        },
      ],
    },
    { recursionLimit: 10 },
  );
  await logLlmUsage({
    response: result,
    userId: state.userId,
    agentType: "daily_welcome_agent",
  });

  const welcomeMessage =
    result.messages[result.messages.length - 1]?.content || "";

  return { welcomeMessage };
}

async function saveAgentMessageNode(
  state: DailyGraphState,
): Promise<Partial<DailyGraphState>> {
  if (!state.welcomeMessage) {
    return {};
  }

  const event: DailyEvent = {
    user_id: state.userId,
    date: state.currentDate,
    role: "agent",
    type: "system",
    subtype: "welcome",
    content: state.welcomeMessage,
  };

  try {
    await supabaseStoreTool.invoke({
      table: "daily_events",
      data: event,
    });
  } catch (error) {
    console.error("Error saving agent message:", error);
  }

  return {};
}

async function classifierAgentNode(
  state: DailyGraphState,
): Promise<Partial<DailyGraphState>> {
  if (!state.userMessage) {
    return { classification: "NOTE" };
  }

  const classifierAgent = createClassifierAgent();

  const result = await classifierAgent.invoke(
    {
      messages: [
        {
          role: "user",
          content: `Classify this message: ${state.userMessage}`,
        },
      ],
    },
    { recursionLimit: 10 },
  );
  await logLlmUsage({
    response: result,
    userId: state.userId,
    agentType: "daily_classifier_agent",
  });

  const classificationText =
    result.messages[result.messages.length - 1]?.content
      ?.trim()
      .toUpperCase() || "NOTE";

  let classification: ClassificationResult = "NOTE";
  if (
    classificationText.includes("QUESTION") &&
    classificationText.includes("NOTE")
  ) {
    classification = "NOTE_PLUS_QUESTION";
  } else if (classificationText.includes("ESCALATE")) {
    classification = "ESCALATE_TO_ASK";
  } else if (classificationText.includes("QUESTION")) {
    classification = "QUESTION";
  }

  return { classification };
}

async function memoryRetrieverNode(
  state: DailyGraphState,
): Promise<Partial<DailyGraphState>> {
  if (!state.userMessage) {
    return {};
  }

  try {
    const resultStr = await memorySearchTool.invoke({
      userId: state.userId,
      query: state.userMessage,
      maxResults: 20,
    });

    const result =
      typeof resultStr === "string" ? JSON.parse(resultStr) : resultStr;
    const memoryContext = buildMemoryContext([result]);

    return { memoryContext };
  } catch (error) {
    handleAgentError(error, {
      agentType: "daily",
      userId: state.userId,
      action: "memory_retrieval",
    });
    return { memoryContext: "" };
  }
}

async function dailyResponseAgentNode(
  state: DailyGraphState,
): Promise<Partial<DailyGraphState>> {
  if (!state.userMessage) {
    return {};
  }

  const responseAgent = createDailyResponseAgent({
    currentDate: state.currentDate,
  });

  // Fetch today's calendar (same source as daily page) so the agent sees meetings
  let todayCalendarContext = "";
  try {
    const client = createAdminClient();
    const meetings = await getTodayMeetingsForUser(
      state.userId,
      state.currentDate,
      client,
    );
    todayCalendarContext = formatTodayMeetingsForContext(meetings);
  } catch (err) {
    console.error("[daily] Failed to fetch today's meetings for context:", err);
  }

  const contextParts: string[] = [];
  if (todayCalendarContext) {
    contextParts.push(todayCalendarContext);
  }
  if (state.memoryContext) {
    contextParts.push(`Memory context:\n${state.memoryContext}`);
  }
  contextParts.push(`User question: ${state.userMessage}`);
  const contextPrompt = contextParts.join("\n\n");

  const result = await responseAgent.invoke(
    {
      messages: [
        {
          role: "user",
          content: contextPrompt,
        },
      ],
    },
    { recursionLimit: 15 },
  );
  await logLlmUsage({
    response: result,
    userId: state.userId,
    agentType: "daily_response_agent",
  });

  const agentResponse =
    result.messages[result.messages.length - 1]?.content || "";

  return { agentResponse };
}

async function saveEventsNode(
  state: DailyGraphState,
): Promise<Partial<DailyGraphState>> {
  const events: DailyEvent[] = [];
  let userEventId = state.userEventId;
  let agentEventId = state.agentEventId;

  // Save user message
  if (state.userMessage) {
    try {
      if (!userEventId) {
        const userEvent: DailyEvent = {
          user_id: state.userId,
          date: state.currentDate,
          role: "user",
          type: "note", // User message stored as 'note' type
          content: state.userMessage,
        };

        const savedEventStr = await supabaseStoreTool.invoke({
          table: "daily_events",
          data: userEvent,
        });
        const savedEvent =
          typeof savedEventStr === "string"
            ? JSON.parse(savedEventStr)
            : savedEventStr;
        userEventId = savedEvent?.id ?? userEventId;
        events.push(userEvent);
      }

      if (userEventId) {
        try {
          const embeddingResultStr = await embeddingGeneratorTool.invoke({
            content: state.userMessage,
          });
          const embeddingResult =
            typeof embeddingResultStr === "string"
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
                  type: "daily_event",
                  source_id: userEventId,
                  date: state.currentDate,
                },
              },
            });
          }
        } catch (embeddingError) {
          console.error("Error storing embedding:", embeddingError);
        }
      }
    } catch (error) {
      console.error("Error saving user event:", error);
    }
  }

  // Save agent response
  if (state.agentResponse) {
    try {
      if (!agentEventId) {
        const agentEvent: DailyEvent = {
          user_id: state.userId,
          date: state.currentDate,
          role: "agent",
          type: "answer", // Agent response stored as 'answer' type
          content: state.agentResponse,
        };

        const savedEventStr = await supabaseStoreTool.invoke({
          table: "daily_events",
          data: agentEvent,
        });
        const savedEvent =
          typeof savedEventStr === "string"
            ? JSON.parse(savedEventStr)
            : savedEventStr;
        agentEventId = savedEvent?.id ?? agentEventId;
        events.push(agentEvent);
      }
    } catch (error) {
      console.error("Error saving agent event:", error);
    }
  }

  return { eventsToSave: events, userEventId, agentEventId };
}

function noteAcknowledgmentNode(
  _state: DailyGraphState,
): Partial<DailyGraphState> {
  return {
    agentResponse: "Got it! If you have any notes or ideas, share them here.",
  };
}

function suggestAskAiNode(_state: DailyGraphState): Partial<DailyGraphState> {
  return {
    agentResponse:
      "This looks like something that may require deeper analysis. Would you like to switch to Ask AI mode?",
  };
}

// Routing Functions

function routeAfterCheckDailyStarted(
  state: DailyGraphState,
): "END" | "dailyWelcomeAgent" {
  if (state.dailyStarted) {
    return "END";
  }
  return "dailyWelcomeAgent";
}

function routeAfterClassifier(state: DailyGraphState): string {
  if (state.classification === "NOTE") {
    return "noteAcknowledgment";
  } else if (
    state.classification === "QUESTION" ||
    state.classification === "NOTE_PLUS_QUESTION"
  ) {
    return "memoryRetriever";
  } else if (state.classification === "ESCALATE_TO_ASK") {
    return "suggestAskAi";
  }
  return "noteAcknowledgment";
}

// Graph Construction

export function createDailyInitGraph() {
  const workflow = new StateGraph<DailyGraphState>({
    channels: {
      userId: { reducer: (x: string, y: string) => y ?? x },
      currentDate: { reducer: (x: string, y: string) => y ?? x },
      welcomeMessage: {
        reducer: (x: string | undefined, y: string | undefined) => y ?? x,
      },
      dailyStarted: {
        reducer: (x: boolean | undefined, y: boolean | undefined) => y ?? x,
      },
    },
  })
    .addNode("checkDailyStarted", checkDailyStartedNode)
    .addNode("dailyWelcomeAgent", dailyWelcomeAgentNode)
    .addNode("saveAgentMessage", saveAgentMessageNode)
    .addEdge(START, "checkDailyStarted")
    .addConditionalEdges("checkDailyStarted", routeAfterCheckDailyStarted, {
      END: END,
      dailyWelcomeAgent: "dailyWelcomeAgent",
    })
    .addEdge("dailyWelcomeAgent", "saveAgentMessage")
    .addEdge("saveAgentMessage", END);

  return workflow.compile();
}

export function createDailyMessageGraph() {
  const workflow = new StateGraph<DailyGraphState>({
    channels: {
      userId: { reducer: (x: string, y: string) => y ?? x },
      currentDate: { reducer: (x: string, y: string) => y ?? x },
      userMessage: {
        reducer: (x: string | undefined, y: string | undefined) => y ?? x,
      },
      classification: {
        reducer: (
          x: ClassificationResult | undefined,
          y: ClassificationResult | undefined,
        ) => y ?? x,
      },
      memoryContext: {
        reducer: (x: string | undefined, y: string | undefined) => y ?? x,
      },
      agentResponse: {
        reducer: (x: string | undefined, y: string | undefined) => y ?? x,
      },
      eventsToSave: {
        reducer: (x: DailyEvent[] | undefined, y: DailyEvent[] | undefined) =>
          y ?? x,
      },
    },
  })
    .addNode("classifierAgent", classifierAgentNode)
    .addNode("memoryRetriever", memoryRetrieverNode)
    .addNode("dailyResponseAgent", dailyResponseAgentNode)
    .addNode("saveEvents", saveEventsNode)
    .addNode("noteAcknowledgment", noteAcknowledgmentNode)
    .addNode("suggestAskAi", suggestAskAiNode)
    .addEdge(START, "classifierAgent")
    .addConditionalEdges("classifierAgent", routeAfterClassifier, {
      noteAcknowledgment: "noteAcknowledgment",
      memoryRetriever: "memoryRetriever",
      suggestAskAi: "suggestAskAi",
    })
    .addEdge("memoryRetriever", "dailyResponseAgent")
    .addEdge("dailyResponseAgent", "saveEvents")
    .addEdge("saveEvents", END)
    .addEdge("noteAcknowledgment", "saveEvents")
    .addEdge("suggestAskAi", "saveEvents");

  return workflow.compile();
}

// Export nodes and routing for durable task handlers
export {
  checkDailyStartedNode,
  dailyWelcomeAgentNode,
  saveAgentMessageNode,
  classifierAgentNode,
  memoryRetrieverNode,
  dailyResponseAgentNode,
  saveEventsNode,
  noteAcknowledgmentNode,
  suggestAskAiNode,
  routeAfterClassifier,
  routeAfterCheckDailyStarted,
};
