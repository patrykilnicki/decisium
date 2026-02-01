"use server";

import { createClient } from "@/lib/supabase/server";
import {
  createDailyInitGraph,
  DailyWelcomeResult,
  DailyMessageResult,
  ClassificationResult,
} from "@/packages/agents/core/daily.agent";
import { processDailyPageMessage } from "@/packages/agents/core/main.agent";
import {
  DailyEventInput,
  DailyEvent as SchemaDailyEvent,
} from "@/packages/agents/schemas/daily.schema";
import { getUserContext } from "@/packages/agents/lib/auth";
import { getCurrentDate } from "@/packages/agents/lib/date-utils";
import { handleAgentError } from "@/packages/agents/lib/error-handler";

export async function initializeDaily(): Promise<DailyWelcomeResult> {
  try {
    // Get authenticated user context
    const { userId, currentDate } = await getUserContext();

    const supabase = await createClient();

    // Check if welcome already sent today
    const { data: existingWelcome } = await supabase
      .from("daily_events")
      .select("*")
      .eq("user_id", userId)
      .eq("date", currentDate)
      .eq("role", "agent")
      .eq("type", "system")
      .eq("subtype", "welcome")
      .limit(1)
      .maybeSingle();

    if (existingWelcome) {
      return {
        welcomeMessage: null,
        alreadyStarted: true,
      };
    }

    // Run initialization graph for welcome message
    const initGraph = createDailyInitGraph();
    const result = await initGraph.invoke({
      userId,
      currentDate,
    });

    return {
      welcomeMessage: result.welcomeMessage || null,
      alreadyStarted: false,
    };
  } catch (error) {
    handleAgentError(error, {
      agentType: "daily",
      action: "initialize_daily",
    });
  }
}

export async function processDailyMessage(
  userMessage: string
): Promise<DailyMessageResult> {
  try {
    // Get authenticated user context
    const { userId, currentDate, userEmail } = await getUserContext();
    const supabase = await createClient();

    // Save user message first
    const { error: userMsgError } = await supabase
      .from("daily_events")
      .insert({
        user_id: userId,
        date: currentDate,
        role: "user",
        type: "note",
        content: userMessage,
      });

    if (userMsgError) {
      console.error("Failed to save user message:", userMsgError);
    }

    // Process through unified agent
    const result = await processDailyPageMessage({
      userId,
      userMessage,
      currentDate,
      userEmail,
    });

    // Save agent response
    if (result.agentResponse) {
      const { error: agentMsgError } = await supabase
        .from("daily_events")
        .insert({
          user_id: userId,
          date: currentDate,
          role: "agent",
          type: "answer",
          content: result.agentResponse,
        });

      if (agentMsgError) {
        console.error("Failed to save agent response:", agentMsgError);
      }
    }

    return {
      agentResponse: result.agentResponse || null,
      eventsSaved: true,
      classification: "NOTE" as ClassificationResult,
    };
  } catch (error) {
    handleAgentError(error, {
      agentType: "daily",
      action: "process_daily_message",
    });
  }
}

export async function processDailyEvent(
  eventId: string
): Promise<string | null> {
  try {
    // Get authenticated user context
    const { userId } = await getUserContext();

    const supabase = await createClient();

    const { data: event, error } = await supabase
      .from("daily_events")
      .select("content")
      .eq("id", eventId)
      .eq("user_id", userId)
      .single();

    if (error || !event) {
      throw new Error("Event not found");
    }

    const result = await processDailyMessage(event.content);
    return result.agentResponse;
  } catch (error) {
    handleAgentError(error, {
      agentType: "daily",
      action: "process_daily_event",
      metadata: { eventId },
    });
  }
}

export async function createDailyEvent(
  input: DailyEventInput
): Promise<SchemaDailyEvent> {
  try {
    // Get authenticated user context
    const { userId } = await getUserContext();

    const supabase = await createClient();

    // Ensure the user_id matches the authenticated user
    const eventData = {
      ...input,
      user_id: userId,
    };

    const { data, error } = await supabase
      .from("daily_events")
      .insert(eventData)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create daily event: ${error.message}`);
    }

    return data as SchemaDailyEvent;
  } catch (error) {
    handleAgentError(error, {
      agentType: "daily",
      action: "create_daily_event",
    });
  }
}

export async function getDailyEvents(
  date?: string
): Promise<SchemaDailyEvent[]> {
  try {
    // Get authenticated user context
    const { userId } = await getUserContext();
    const targetDate = date || getCurrentDate();

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("daily_events")
      .select("*")
      .eq("user_id", userId)
      .eq("date", targetDate)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch daily events: ${error.message}`);
    }

    return (data || []) as SchemaDailyEvent[];
  } catch (error) {
    handleAgentError(error, {
      agentType: "daily",
      action: "get_daily_events",
    });
  }
}
