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
import type { TaskRecord } from "@/lib/tasks/task-types";
import type { TaskType } from "@/lib/tasks/task-definitions";
import { getTaskNodeId } from "@/lib/tasks/task-definitions";
import { getTaskStepLabel } from "@/packages/agents/lib/step-mappings";

const initialThinkingState: ThinkingState = {
  isThinking: false,
  steps: [],
  streamedContent: undefined,
};

export function useChat({
  apiEndpoint,
  mode = "stream",
  sessionId,
  tasksEndpoint = "/api/tasks",
  messagesEndpoint,
  pollIntervalMs = 1500,
  initialMessages = [],
  onMessageSent,
  onMessageReceived,
  onError,
}: UseChatConfig): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [thinkingState, setThinkingState] =
    useState<ThinkingState>(initialThinkingState);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getLatestTaskGroup = useCallback(
    (allTasks: TaskRecord[]): TaskRecord[] => {
      const roots = allTasks.filter((task) => !task.parentTaskId);
      const sortedRoots = [...roots].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      const latestRoot = sortedRoots[0];
      if (!latestRoot) return allTasks;

      const byParent = new Map<string, TaskRecord[]>();
      allTasks.forEach((task) => {
        if (!task.parentTaskId) return;
        const existing = byParent.get(task.parentTaskId) ?? [];
        existing.push(task);
        byParent.set(task.parentTaskId, existing);
      });

      const collected = new Map<string, TaskRecord>();
      const stack = [latestRoot];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current || collected.has(current.id)) continue;
        collected.set(current.id, current);
        const children = byParent.get(current.id) ?? [];
        children.forEach((child) => stack.push(child));
      }

      return Array.from(collected.values()).sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    },
    [],
  );

  function mapTaskStatus(status: string): ThinkingStep["status"] {
    if (status === "in_progress") return "running";
    if (status === "completed") return "completed";
    if (status === "failed") return "error";
    return "pending";
  }

  const buildThinkingState = useCallback(
    (allTasks: TaskRecord[]): ThinkingState => {
      const tasksForRun = getLatestTaskGroup(allTasks);
      const steps = tasksForRun.map((task) => {
        const taskType = task.taskType as TaskType;
        const stepId = getTaskNodeId(taskType);
        const label = getTaskStepLabel(taskType);
        return {
          stepId,
          label,
          status: mapTaskStatus(task.status),
          timestamp: new Date(task.createdAt).getTime(),
        };
      });

      const hasActive = tasksForRun.some(
        (task) => task.status === "pending" || task.status === "in_progress",
      );

      return {
        isThinking: hasActive,
        steps,
        streamedContent: undefined,
      };
    },
    [getLatestTaskGroup],
  );

  const fetchTasks = useCallback(async () => {
    if (!sessionId) return [];
    const response = await fetch(
      `${tasksEndpoint}?sessionId=${encodeURIComponent(sessionId)}`,
    );
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error ?? "Failed to fetch tasks");
    }
    const data = (await response.json()) as TaskRecord[];
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

  const pollTasks = useCallback(async () => {
    if (!sessionId) return;
    try {
      const latestTasks = await fetchTasks();
      setTasks(latestTasks);

      const thinking = buildThinkingState(latestTasks);
      setThinkingState(thinking);

      const latestFailed = getLatestTaskGroup(latestTasks).find(
        (task) => task.status === "failed" && task.lastError,
      );
      if (latestFailed?.lastError) {
        setError(latestFailed.lastError);
      }

      if (!thinking.isThinking) {
        await refreshMessages();
        stopTaskPolling();
      }
    } catch (pollError) {
      const message =
        pollError instanceof Error ? pollError.message : "Failed to poll tasks";
      setError(message);
    }
  }, [
    buildThinkingState,
    fetchTasks,
    getLatestTaskGroup,
    refreshMessages,
    sessionId,
    stopTaskPolling,
  ]);

  const startTaskPolling = useCallback(() => {
    if (pollerRef.current) return;
    pollTasks();
    pollerRef.current = setInterval(pollTasks, pollIntervalMs);
  }, [pollIntervalMs, pollTasks]);

  const reset = useCallback(() => {
    setMessages(initialMessages);
    setThinkingState(initialThinkingState);
    setIsLoading(false);
    setError(null);
    stopTaskPolling();
  }, [initialMessages, stopTaskPolling]);

  const retryTask = useCallback(
    async (taskId: string) => {
      await fetch(`/api/tasks/${taskId}/retry`, { method: "POST" });
      startTaskPolling();
    },
    [startTaskPolling],
  );

  const cancelTask = useCallback(
    async (taskId: string) => {
      await fetch(`/api/tasks/${taskId}/cancel`, { method: "POST" });
      startTaskPolling();
    },
    [startTaskPolling],
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

          startTaskPolling();
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
      startTaskPolling,
    ],
  );

  useEffect(() => {
    if (mode !== "task" || !sessionId) return;
    startTaskPolling();
    return () => stopTaskPolling();
  }, [mode, sessionId, startTaskPolling, stopTaskPolling]);

  return {
    messages,
    thinkingState,
    sendMessage,
    isLoading,
    error,
    reset,
    setMessages,
    tasks,
    retryTask,
    cancelTask,
  };
}
