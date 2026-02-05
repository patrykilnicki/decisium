"use server";

import { createClient } from "@/lib/supabase/server";
import { DailyWelcomeResult } from "@/packages/agents/core/daily.agent";
import {
  DailyEventInput,
  DailyEvent as SchemaDailyEvent,
} from "@/packages/agents/schemas/daily.schema";
import { getUserContext } from "@/packages/agents/lib/auth";
import { getCurrentDate } from "@/packages/agents/lib/date-utils";
import { handleAgentError } from "@/packages/agents/lib/error-handler";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueTask } from "@/lib/tasks/task-repository";
import type { Json } from "@/types/supabase";

export async function initializeDaily(): Promise<DailyWelcomeResult> {
  try {
    // Empty state: no welcome message is generated. When the user sends their
    // first message, the chat opens with the existing conversation flow.
    return {
      welcomeMessage: null,
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
  userMessage: string,
): Promise<{ taskId: string; userEventId?: string }> {
  try {
    // Get authenticated user context
    const { userId, currentDate } = await getUserContext();
    const supabase = await createClient();

    // Save user message first
    const { data: savedEvent, error: userMsgError } = await supabase
      .from("daily_events")
      .insert({
        user_id: userId,
        date: currentDate,
        role: "user",
        type: "note",
        content: userMessage,
      })
      .select("id")
      .single();

    if (userMsgError) {
      console.error("Failed to save user message:", userMsgError);
    }

    const adminClient = createAdminClient();
    const sessionId = `daily:${currentDate}`;
    const task = await enqueueTask(adminClient, {
      user_id: userId,
      session_id: sessionId,
      task_type: "daily.classifier_agent",
      status: "pending",
      input: {
        state: {
          userId,
          currentDate,
          userMessage,
          userEventId: savedEvent?.id,
        },
      } as Json,
    });

    // Process immediately in background (fire-and-forget)
    // Cron will catch any failures
    const { processTaskImmediately } =
      await import("@/lib/tasks/task-processor");
    processTaskImmediately(task.id);

    return {
      taskId: task.id,
      userEventId: savedEvent?.id,
    };
  } catch (error) {
    handleAgentError(error, {
      agentType: "daily",
      action: "process_daily_message",
    });
  }
}

export async function processDailyEvent(
  eventId: string,
): Promise<{ taskId: string } | null> {
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
    return { taskId: result.taskId };
  } catch (error) {
    handleAgentError(error, {
      agentType: "daily",
      action: "process_daily_event",
      metadata: { eventId },
    });
  }
}

export async function createDailyEvent(
  input: DailyEventInput,
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
  date?: string,
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

import {
  getTodayMeetingsForUser,
  type TodayMeetingRow,
} from "@/lib/calendar/today-meetings";

export type TodayMeeting = TodayMeetingRow;

/**
 * Get today's calendar events (meetings) from activity_atoms.
 * Uses a 3-day window then filters by date string to avoid timezone edge cases.
 * Returns [] when not authenticated (e.g. session not yet available on first load).
 * @param date - Optional date in YYYY-MM-DD (client's local "today").
 */
export async function getTodayMeetings(date?: string): Promise<TodayMeeting[]> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return [];
    }

    const targetDate = date ?? getCurrentDate();
    return getTodayMeetingsForUser(user.id, targetDate, supabase);
  } catch (error) {
    console.error("Error getting today's meetings:", error);
    return [];
  }
}

/**
 * Get count of today's calendar events. Pass client's local date to match user's "today".
 */
export async function getTodayMeetingsCount(date?: string): Promise<number> {
  try {
    const meetings = await getTodayMeetings(date);
    return meetings.length;
  } catch (error) {
    console.error("Error getting today's meetings count:", error);
    return 0;
  }
}
