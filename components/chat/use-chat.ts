"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  ChatMessage,
  ThinkingState,
  ThinkingStep,
  StreamEvent,
  UseChatConfig,
  UseChatReturn,
} from "./types";
import type { TaskType } from "@/lib/tasks/task-definitions";
import { getTaskStepLabel } from "@/packages/agents/lib/step-mappings";
import type { TaskEventRecord } from "@/lib/tasks/task-events";

const initialThinkingState: ThinkingState = {
  isThinking: false,
  steps: [],
  streamedContent: undefined,
};

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

export function useChat({
  apiEndpoint,
  mode = "stream",
  sessionId,
  tasksEndpoint = "/api/tasks/events",
  tasksStreamEndpoint = "/api/tasks/stream",
  taskStreamEnabled = true,
  taskStreamReconnectMs = 1000,
  messagesEndpoint,
  pollIntervalMs = 1500,
  initialMessages = [],
  onMessageSent,
  onMessageReceived,
  onError,
}: UseChatConfig & {
  tasksStreamEndpoint?: string;
  taskStreamEnabled?: boolean;
  taskStreamReconnectMs?: number;
}): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [thinkingState, setThinkingState] =
    useState<ThinkingState>(initialThinkingState);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskEvents, setTaskEvents] = useState<TaskEventRecord[]>([]);
  const [failedTaskIds, setFailedTaskIds] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<EventSource | null>(null);
  const streamReconnectRef = useRef(0);
  const streamReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const startTaskStreamingRef = useRef<() => void>(() => {});
  const taskStreamOpenedAtRef = useRef<number>(0);
  const TASK_STREAM_GRACE_MS = 5000;

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
      const stepsById = new Map<
        string,
        { step: ThinkingStep; firstTimestamp: number }
      >();

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

        const stepId = nodeKey;
        const label = getTaskStepLabel(nodeKey as TaskType);
        const timestamp = new Date(event.createdAt).getTime();
        const existing = stepsById.get(stepId);
        const status =
          event.eventType === "node_started"
            ? "running"
            : event.eventType === "node_completed"
              ? "completed"
              : "error";

        if (!existing) {
          stepsById.set(stepId, {
            step: { stepId, label, status, timestamp },
            firstTimestamp: timestamp,
          });
        } else {
          existing.step.status = status;
        }
      });

      const steps = Array.from(stepsById.values())
        .sort((a, b) => a.firstTimestamp - b.firstTimestamp)
        .map((entry) => entry.step);

      const latestJobEvent = [...latestEvents]
        .reverse()
        .find((event) => event.eventType.startsWith("job_"));
      const isJobFinished =
        latestJobEvent?.eventType === "job_completed" ||
        latestJobEvent?.eventType === "job_failed";
      const hasJobActivity = latestEvents.length > 0 || steps.length > 0;
      const isThinking = !isJobFinished && hasJobActivity;

      return {
        isThinking,
        steps,
        streamedContent: undefined,
      };
    },
    [getLatestJobEvents],
  );

  function isJobFinished(events: TaskEventRecord[]): boolean {
    const latestJobEvent = [...events]
      .reverse()
      .find((event) => event.eventType.startsWith("job_"));
    return (
      latestJobEvent?.eventType === "job_completed" ||
      latestJobEvent?.eventType === "job_failed"
    );
  }

  const fetchTaskEvents = useCallback(async () => {
    if (!sessionId) return [];
    const response = await fetch(
      `${tasksEndpoint}?sessionId=${encodeURIComponent(sessionId)}`,
    );
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error ?? "Failed to fetch task events");
    }
    const data = (await response.json()) as TaskEventRecord[];
    return Array.isArray(data) ? data : [];
  }, [sessionId, tasksEndpoint]);

  const refreshMessages = useCallback(async () => {
    const endpoint = messagesEndpoint ?? apiEndpoint;
    const response = await fetch(endpoint);
    if (!response.ok) return;
    const data = (await response.json()) as Array<{
      id: string;
      role: ChatMessage["role"];
      content: string;
      created_at?: string;
    }>;

    if (!Array.isArray(data)) return;
    const nextMessages = data
      .filter((msg) => msg != null && msg.role != null)
      .map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        createdAt: msg.created_at,
      }));
    setMessages(nextMessages);
  }, [apiEndpoint, messagesEndpoint]);

  const stopTaskPolling = useCallback(() => {
    if (pollerRef.current) {
      clearInterval(pollerRef.current);
      pollerRef.current = null;
    }
  }, []);

  const stopTaskStreaming = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
    if (streamReconnectTimerRef.current) {
      clearTimeout(streamReconnectTimerRef.current);
      streamReconnectTimerRef.current = null;
    }
    streamReconnectRef.current = 0;
  }, []);

  const applyTaskEventsUpdate = useCallback(
    async (latestEvents: TaskEventRecord[]) => {
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

      if (isJobFinished(latestJobEvents)) {
        const withinGrace =
          Date.now() - taskStreamOpenedAtRef.current < TASK_STREAM_GRACE_MS;
        if (withinGrace && latestEvents.length === 0) {
          // Empty tasks right after opening stream may be a race; keep stream open
          return;
        }
        await refreshMessages();
        stopTaskPolling();
        stopTaskStreaming();
      }
    },
    [
      buildThinkingState,
      getLatestJobEvents,
      refreshMessages,
      stopTaskPolling,
      stopTaskStreaming,
    ],
  );

  const pollTaskEvents = useCallback(async () => {
    if (!sessionId) return;
    try {
      const latestEvents = await fetchTaskEvents();
      await applyTaskEventsUpdate(latestEvents);
    } catch (pollError) {
      const message =
        pollError instanceof Error
          ? pollError.message
          : "Failed to poll events";
      setError(message);
    }
  }, [applyTaskEventsUpdate, fetchTaskEvents, sessionId]);

  const startTaskPolling = useCallback(() => {
    if (pollerRef.current) return;
    stopTaskStreaming();
    pollTaskEvents();
    pollerRef.current = setInterval(pollTaskEvents, pollIntervalMs);
  }, [pollIntervalMs, pollTaskEvents, stopTaskStreaming]);

  const isTaskStreamEnabled =
    taskStreamEnabled && typeof EventSource !== "undefined";

  const scheduleStreamReconnect = useCallback(() => {
    if (!isTaskStreamEnabled || !sessionId) return;
    if (streamReconnectTimerRef.current) return;
    const attempt = streamReconnectRef.current + 1;
    streamReconnectRef.current = attempt;
    const delay = Math.min(taskStreamReconnectMs * 2 ** (attempt - 1), 10000);
    streamReconnectTimerRef.current = setTimeout(() => {
      streamReconnectTimerRef.current = null;
      startTaskStreamingRef.current();
    }, delay);
  }, [isTaskStreamEnabled, sessionId, taskStreamReconnectMs]);

  const startTaskStreaming = useCallback(() => {
    if (!sessionId || !isTaskStreamEnabled) return;
    if (streamRef.current) return;
    stopTaskPolling();

    const url = `${tasksStreamEndpoint}?sessionId=${encodeURIComponent(
      sessionId,
    )}`;
    const eventSource = new EventSource(url);
    streamRef.current = eventSource;
    taskStreamOpenedAtRef.current = Date.now();

    eventSource.onopen = () => {
      streamReconnectRef.current = 0;
    };

    eventSource.onmessage = async (event) => {
      try {
        const latestEvents = JSON.parse(event.data) as TaskEventRecord[];
        await applyTaskEventsUpdate(latestEvents);
      } catch (parseError) {
        const message =
          parseError instanceof Error
            ? parseError.message
            : "Failed to parse event stream";
        setError(message);
      }
    };

    eventSource.addEventListener("error", (event) => {
      if (event instanceof MessageEvent && typeof event.data === "string") {
        try {
          const payload = JSON.parse(event.data) as { error?: string };
          if (payload?.error) setError(payload.error);
        } catch {
          // Ignore parse errors for non-JSON error events
        }
      }
    });

    eventSource.onerror = () => {
      stopTaskStreaming();
      startTaskPolling();
      scheduleStreamReconnect();
    };
  }, [
    applyTaskEventsUpdate,
    isTaskStreamEnabled,
    scheduleStreamReconnect,
    sessionId,
    startTaskPolling,
    stopTaskPolling,
    stopTaskStreaming,
    tasksStreamEndpoint,
  ]);

  useEffect(() => {
    startTaskStreamingRef.current = startTaskStreaming;
  }, [startTaskStreaming]);

  const startTaskTracking = useCallback(() => {
    if (isTaskStreamEnabled) {
      startTaskStreaming();
    } else {
      startTaskPolling();
    }
  }, [isTaskStreamEnabled, startTaskPolling, startTaskStreaming]);

  const reset = useCallback(() => {
    setMessages(initialMessages);
    setThinkingState(initialThinkingState);
    setIsLoading(false);
    setError(null);
    setTaskEvents([]);
    setFailedTaskIds([]);
    stopTaskPolling();
    stopTaskStreaming();
  }, [initialMessages, stopTaskPolling, stopTaskStreaming]);

  const retryTask = useCallback(
    async (taskId: string) => {
      await fetch(`/api/tasks/${taskId}/retry`, { method: "POST" });
      startTaskTracking();
    },
    [startTaskTracking],
  );

  const cancelTask = useCallback(
    async (taskId: string) => {
      await fetch(`/api/tasks/${taskId}/cancel`, { method: "POST" });
      startTaskTracking();
    },
    [startTaskTracking],
  );

  const resumeTask = useCallback(
    async (taskId: string) => {
      await fetch(`/api/tasks/${taskId}/resume`, { method: "POST" });
      startTaskTracking();
    },
    [startTaskTracking],
  );

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case "run_started":
        setThinkingState((prev) => ({
          ...prev,
          steps: [],
          streamedContent: undefined,
        }));
        setError(null);
        break;

      case "step_started":
        if (event.stepId && event.label) {
          const stepId = event.stepId;
          const label = event.label;
          const timestamp = event.timestamp;
          setThinkingState((prev) => {
            const exists = prev.steps.some((s) => s.stepId === stepId);
            if (exists) {
              return {
                ...prev,
                steps: prev.steps.map((s) =>
                  s.stepId === stepId
                    ? { ...s, status: "running" as const }
                    : s,
                ),
              };
            }
            return {
              ...prev,
              steps: [
                ...prev.steps,
                {
                  stepId,
                  label,
                  status: "running" as const,
                  timestamp,
                },
              ],
            };
          });
        }
        break;

      case "step_completed":
        if (event.stepId) {
          const completedStepId = event.stepId;
          setThinkingState((prev) => ({
            ...prev,
            steps: prev.steps.map((s) =>
              s.stepId === completedStepId
                ? { ...s, status: "completed" as const }
                : s,
            ),
          }));
        }
        break;

      case "step_error":
        if (event.stepId) {
          const errorStepId = event.stepId;
          setThinkingState((prev) => ({
            ...prev,
            steps: prev.steps.map((s) =>
              s.stepId === errorStepId ? { ...s, status: "error" as const } : s,
            ),
          }));
        }
        if (event.error) {
          setError(event.error);
        }
        break;

      case "message_content":
        if (event.content) {
          setThinkingState((prev) => ({
            ...prev,
            streamedContent: (prev.streamedContent || "") + event.content,
          }));
        }
        break;

      case "run_error":
        setError(event.error ?? "An error occurred");
        setThinkingState((prev) => ({
          ...prev,
          isThinking: false,
        }));
        break;

      case "run_finished":
        // Mark all remaining steps as completed
        setThinkingState((prev) => ({
          ...prev,
          isThinking: false,
          steps: prev.steps.map((s) =>
            s.status === "running" ? { ...s, status: "completed" as const } : s,
          ),
        }));
        break;
    }
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      // Cancel any existing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      // Create optimistic user message
      const userMessage: ChatMessage = {
        id: `temp-user-${Date.now()}`,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };

      // Add user message immediately (optimistic update)
      setMessages((prev) => [...prev, userMessage]);
      onMessageSent?.(userMessage);

      // Set thinking state
      setIsLoading(true);
      setThinkingState({
        isThinking: true,
        steps: [],
        streamedContent: undefined,
      });
      setError(null);

      try {
        if (mode === "task") {
          const response = await fetch(apiEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
            signal: abortControllerRef.current.signal,
          });

          if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody.error ?? "Failed to send message");
          }

          const result = await response.json();
          if (result?.userMessage) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === userMessage.id
                  ? {
                      ...result.userMessage,
                      createdAt: result.userMessage.created_at,
                    }
                  : m,
              ),
            );
          }

          startTaskTracking();
        } else {
          const response = await fetch(apiEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify({ content }),
            signal: abortControllerRef.current.signal,
          });

          if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody.error ?? "Failed to send message");
          }

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error("No response body");
          }

          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete events from buffer
            const lines = buffer.split("\n\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;

              try {
                const eventData = line.slice(6);
                const event: StreamEvent = JSON.parse(eventData);

                handleStreamEvent(event);

                // Handle message data if present
                if (event.userMessage) {
                  // Replace temp user message with real one
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === userMessage.id
                        ? {
                            ...event.userMessage!,
                            createdAt: event.userMessage!.createdAt,
                          }
                        : m,
                    ),
                  );
                }

                if (event.assistantMessage) {
                  setMessages((prev) => {
                    // Check if assistant message already exists
                    const exists = prev.some(
                      (m) => m.id === event.assistantMessage!.id,
                    );
                    if (exists) return prev;
                    return [
                      ...prev,
                      {
                        ...event.assistantMessage!,
                        createdAt: event.assistantMessage!.createdAt,
                      },
                    ];
                  });
                  onMessageReceived?.(event.assistantMessage);
                }
              } catch (parseError) {
                console.warn("Failed to parse SSE event:", parseError);
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }

        const errorMessage =
          err instanceof Error ? err.message : "An error occurred";
        setError(errorMessage);
        onError?.(errorMessage);

        // Remove optimistic user message on error
        setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
      } finally {
        setIsLoading(false);
        if (mode !== "task") {
          setThinkingState((prev) => ({
            ...prev,
            isThinking: false,
          }));
        }
      }
    },
    [
      apiEndpoint,
      handleStreamEvent,
      mode,
      onMessageReceived,
      onMessageSent,
      onError,
      startTaskTracking,
    ],
  );

  useEffect(() => {
    if (mode !== "task" || !sessionId) return;
    startTaskTracking();
    return () => {
      stopTaskPolling();
      stopTaskStreaming();
    };
  }, [mode, sessionId, startTaskTracking, stopTaskPolling, stopTaskStreaming]);

  return {
    messages,
    thinkingState,
    sendMessage,
    isLoading,
    error,
    reset,
    setMessages,
    taskEvents,
    failedTaskIds,
    retryTask,
    cancelTask,
    resumeTask,
  };
}
