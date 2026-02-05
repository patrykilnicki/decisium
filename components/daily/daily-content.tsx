"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DailyEvent } from "@/packages/agents/schemas/daily.schema";
import {
  ChatContainer,
  ChatInput,
  ChatMessageType,
  ThinkingState,
} from "@/components/chat";
import { DailyEmptyState } from "@/components/daily/daily-empty-state";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { initializeDaily, getTodayMeetingsCount } from "@/app/actions/daily";
import { Calendar, Loader2 } from "lucide-react";
import type { TaskType } from "@/lib/tasks/task-definitions";
import { getTaskStepLabel } from "@/packages/agents/lib/step-mappings";
import type { TaskEventRecord } from "@/lib/tasks/task-events";

// Transform DailyEvent to ChatMessage
function transformEvent(event: DailyEvent): ChatMessageType {
  return {
    id: event.id || `event-${Date.now()}-${Math.random()}`,
    role: event.role === "agent" ? "assistant" : event.role,
    content: event.content,
    createdAt: event.created_at,
  };
}

export function DailyContent() {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [meetingsCount, setMeetingsCount] = useState<number>(0);
  const [thinkingState, setThinkingState] = useState<ThinkingState>({
    isThinking: false,
    steps: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [taskEvents, setTaskEvents] = useState<TaskEventRecord[]>([]);
  const [failedTaskIds, setFailedTaskIds] = useState<string[]>([]);
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meetingsPollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const today = format(new Date(), "yyyy-MM-dd");
  const sessionId = `daily:${today}`;

  const refreshMeetingsCount = useCallback(async () => {
    try {
      const count = await getTodayMeetingsCount(today);
      setMeetingsCount(count);
    } catch {
      // ignore
    }
  }, [today]);

  const loadEvents = useCallback(async () => {
    try {
      const response = await fetch(`/api/daily/events?date=${today}`);
      if (response.ok) {
        const data: DailyEvent[] = await response.json();
        const transformedMessages = data
          .filter(
            (event) =>
              event != null &&
              event.role != null &&
              // Exclude legacy welcome message (agent system message)
              !(event.role === "agent" && event.type === "system"),
          )
          .map(transformEvent);
        setMessages(transformedMessages);
      }
    } catch (error) {
      console.error("Failed to load events:", error);
      setError("Failed to load messages");
    }
  }, [today]);

  function getPayloadValue<T>(
    payload: Record<string, unknown>,
    key: string,
  ): T | null {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) return null;
    return payload[key] as T;
  }

  function getJobIdFromEvent(event: TaskEventRecord): string | null {
    const payloadJobId = getPayloadValue<string>(event.payload, "jobId");
    if (typeof payloadJobId === "string" && payloadJobId.length > 0) {
      return payloadJobId;
    }
    return null;
  }

  const getLatestJobId = useCallback(
    (events: TaskEventRecord[]): string | null => {
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (event.eventType === "job_started") {
          const jobId = getJobIdFromEvent(event);
          return jobId ?? event.taskId;
        }
      }

      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        const jobId = getJobIdFromEvent(event);
        if (jobId) return jobId;
      }

      return null;
    },
    [],
  );

  const getLatestJobEvents = useCallback(
    (events: TaskEventRecord[]): TaskEventRecord[] => {
      const jobId = getLatestJobId(events);
      if (!jobId) return events;
      return events.filter((event) => getJobIdFromEvent(event) === jobId);
    },
    [getLatestJobId],
  );

  const buildThinkingState = useCallback(
    (events: TaskEventRecord[]): ThinkingState => {
      const latestEvents = getLatestJobEvents(events);
      const stepsById = new Map<string, ThinkingState["steps"][number]>();

      latestEvents.forEach((event) => {
        if (!event.eventType.startsWith("node_")) return;
        const payloadTaskType = getPayloadValue<string>(
          event.payload,
          "taskType",
        );
        const nodeKey =
          event.nodeKey ??
          (typeof payloadTaskType === "string" ? payloadTaskType : "");
        if (!nodeKey) return;

        const label = getTaskStepLabel(nodeKey as TaskType);
        const status =
          event.eventType === "node_started"
            ? "running"
            : event.eventType === "node_completed"
              ? "completed"
              : "error";

        stepsById.set(nodeKey, { stepId: nodeKey, label, status });
      });

      const steps = Array.from(stepsById.values());
      const latestJobEvent = [...latestEvents]
        .reverse()
        .find((event) => event.eventType.startsWith("job_"));
      const hasActive = steps.some((step) => step.status === "running");
      const isThinking =
        latestJobEvent?.eventType === "job_completed" ||
        latestJobEvent?.eventType === "job_failed"
          ? false
          : hasActive;

      return {
        isThinking,
        steps,
        streamedContent: undefined,
      };
    },
    [getLatestJobEvents],
  );

  const fetchTaskEvents = useCallback(async () => {
    const response = await fetch(
      `/api/tasks/events?sessionId=${encodeURIComponent(sessionId)}`,
    );
    if (!response.ok) return [];
    const data = (await response.json()) as TaskEventRecord[];
    return Array.isArray(data) ? data : [];
  }, [sessionId]);

  const stopPolling = useCallback(() => {
    if (pollerRef.current) {
      clearInterval(pollerRef.current);
      pollerRef.current = null;
    }
  }, []);

  const pollTaskEvents = useCallback(async () => {
    try {
      const latestEvents = await fetchTaskEvents();
      setTaskEvents(latestEvents);
      const thinking = buildThinkingState(latestEvents);
      setThinkingState(thinking);

      const latestJobEvents = getLatestJobEvents(latestEvents);
      const failedEvents = latestJobEvents.filter(
        (event) => event.eventType === "node_failed",
      );
      const failedIds = Array.from(
        new Set(failedEvents.map((event) => event.taskId)),
      );
      setFailedTaskIds(failedIds);

      const latestFailedEvent = [...latestJobEvents]
        .reverse()
        .find(
          (event) =>
            event.eventType === "node_failed" ||
            event.eventType === "job_failed",
        );
      if (latestFailedEvent) {
        const errorMessage = getPayloadValue<string>(
          latestFailedEvent.payload,
          "error",
        );
        if (errorMessage) setError(errorMessage);
      } else {
        setError(null);
      }

      if (!thinking.isThinking) {
        await loadEvents();
        stopPolling();
      }
    } catch (pollError) {
      const message =
        pollError instanceof Error
          ? pollError.message
          : "Failed to poll events";
      setError(message);
    }
  }, [
    buildThinkingState,
    fetchTaskEvents,
    getLatestJobEvents,
    loadEvents,
    stopPolling,
  ]);

  const startPolling = useCallback(() => {
    if (pollerRef.current) return;
    pollTaskEvents();
    pollerRef.current = setInterval(pollTaskEvents, 1500);
  }, [pollTaskEvents]);

  useEffect(() => {
    async function onPageOpen() {
      try {
        setLoading(true);
        await initializeDaily();
        // Fetch today's meetings count (pass client's local date to avoid timezone mismatch)
        const count = await getTodayMeetingsCount(today);
        setMeetingsCount(count);
      } catch (error) {
        console.error("Failed to initialize daily:", error);
      } finally {
        await loadEvents();
        setLoading(false);
      }
    }
    onPageOpen();
  }, [loadEvents, today]);

  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  // Poll today's meetings count so new/updated calendar events appear without full page refresh
  useEffect(() => {
    const intervalMs = 90 * 1000;
    meetingsPollerRef.current = setInterval(refreshMeetingsCount, intervalMs);
    return () => {
      if (meetingsPollerRef.current) {
        clearInterval(meetingsPollerRef.current);
        meetingsPollerRef.current = null;
      }
    };
  }, [refreshMeetingsCount]);

  const handleSend = useCallback(
    async (content: string) => {
      setError(null);

      // Add optimistic user message
      const userMessage: ChatMessageType = {
        id: `temp-user-${Date.now()}`,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Show thinking state (will be updated by task polling)
      setThinkingState({
        isThinking: true,
        steps: [],
        streamedContent: undefined,
      });

      try {
        const respondResponse = await fetch("/api/daily/respond", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: content }),
        });

        if (!respondResponse.ok) {
          const errorData = await respondResponse.json();
          throw new Error(errorData.error || "Failed to process message");
        }
        startPolling();
      } catch (error) {
        console.error("Failed to send message:", error);
        setError(
          error instanceof Error ? error.message : "Failed to send message",
        );

        // Remove optimistic user message on error
        setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));

        // Reset thinking state
        setThinkingState({
          isThinking: false,
          steps: [],
        });

        throw error;
      }
    },
    [startPolling],
  );

  const failedTasks = failedTaskIds;

  const retryTask = useCallback(
    async (taskId: string) => {
      await fetch(`/api/tasks/${taskId}/retry`, { method: "POST" });
      startPolling();
    },
    [startPolling],
  );

  const cancelTask = useCallback(
    async (taskId: string) => {
      await fetch(`/api/tasks/${taskId}/cancel`, { method: "POST" });
      startPolling();
    },
    [startPolling],
  );

  const resumeTask = useCallback(
    async (taskId: string) => {
      await fetch(`/api/tasks/${taskId}/resume`, { method: "POST" });
      startPolling();
    },
    [startPolling],
  );

  if (loading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <Loader2 className="size-8 animate-spin" />
          <span className="text-sm font-medium">Loading your daily...</span>
        </div>
      </div>
    );
  }

  // Show empty state (first screen) only when truly empty (no messages at all)
  // Once any message exists (including optimistic), switch to chat view (second screen)
  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full relative min-h-0">
      {isEmpty ? (
        // First screen: Empty state with full input below meetings (all in scrollable area)
        <div className="flex-1 overflow-auto min-h-0">
          <DailyEmptyState
            showDisclaimer={true}
            meetingsCount={meetingsCount}
            today={today}
          >
            {failedTasks.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    Some steps failed. You can retry, resume, or cancel.
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retryTask(failedTasks[0])}
                    >
                      Retry
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => resumeTask(failedTasks[0])}
                    >
                      Resume
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => cancelTask(failedTasks[0])}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <ChatInput
                variant="full"
                placeholder="What matters today?"
                onSend={handleSend}
                isLoading={thinkingState.isThinking}
              />
            </div>
          </DailyEmptyState>
        </div>
      ) : (
        // Second screen: Chat interface with messages
        <>
          <div className="bg-background/10 backdrop-blur supports-[backdrop-filter]:bg-background/80 z-10 p-6 shrink-0 font-semibold flex items-center gap-2">
            <Calendar className="size-4 text-muted-foreground" />{" "}
            {format(new Date(today), "EEEE, MMMM d, yyyy")}
          </div>
          {failedTasks.length > 0 && (
            <div className="px-6 pt-4">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    Some steps failed. You can retry, resume, or cancel.
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retryTask(failedTasks[0])}
                    >
                      Retry
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => resumeTask(failedTasks[0])}
                    >
                      Resume
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => cancelTask(failedTasks[0])}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="flex-1 min-h-0">
            <ChatContainer
              messages={messages}
              thinkingState={thinkingState}
              onSend={handleSend}
              isLoading={thinkingState.isThinking}
              placeholder="What matters today?"
            />
          </div>
        </>
      )}

      {/* Error display */}
      {error && (
        <div className="absolute bottom-20 left-4 right-4 mx-auto max-w-3xl z-20">
          <div className="px-4 py-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">
            {error}
          </div>
        </div>
      )}
    </div>
  );
}
