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
import type { TaskRecord } from "@/lib/tasks/task-types";
import type { TaskType } from "@/lib/tasks/task-definitions";
import { getTaskNodeId } from "@/lib/tasks/task-definitions";
import { getTaskStepLabel } from "@/packages/agents/lib/step-mappings";

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
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const today = format(new Date(), "yyyy-MM-dd");
  const sessionId = `daily:${today}`;

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
              !(event.role === "agent" && event.type === "system")
          )
          .map(transformEvent);
        setMessages(transformedMessages);
      }
    } catch (error) {
      console.error("Failed to load events:", error);
      setError("Failed to load messages");
    }
  }, [today]);

  const getLatestTaskGroup = useCallback((allTasks: TaskRecord[]) => {
    const roots = allTasks.filter((task) => !task.parentTaskId);
    const sortedRoots = [...roots].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
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
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }, []);

  function mapTaskStatus(status: string): ThinkingState["steps"][number]["status"] {
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
        };
      });

      const hasActive = tasksForRun.some(
        (task) => task.status === "pending" || task.status === "in_progress"
      );

      return {
        isThinking: hasActive,
        steps,
        streamedContent: undefined,
      };
    },
    [getLatestTaskGroup]
  );

  const fetchTasks = useCallback(async () => {
    const response = await fetch(
      `/api/tasks?sessionId=${encodeURIComponent(sessionId)}`
    );
    if (!response.ok) return [];
    const data = (await response.json()) as TaskRecord[];
    return Array.isArray(data) ? data : [];
  }, [sessionId]);

  const stopPolling = useCallback(() => {
    if (pollerRef.current) {
      clearInterval(pollerRef.current);
      pollerRef.current = null;
    }
  }, []);

  const pollTasks = useCallback(async () => {
    try {
      const latestTasks = await fetchTasks();
      setTasks(latestTasks);
      const thinking = buildThinkingState(latestTasks);
      setThinkingState(thinking);

      const latestFailed = getLatestTaskGroup(latestTasks).find(
        (task) => task.status === "failed" && task.lastError
      );
      if (latestFailed?.lastError) {
        setError(latestFailed.lastError);
      }

      if (!thinking.isThinking) {
        await loadEvents();
        stopPolling();
      }
    } catch (pollError) {
      const message =
        pollError instanceof Error ? pollError.message : "Failed to poll tasks";
      setError(message);
    }
  }, [buildThinkingState, fetchTasks, getLatestTaskGroup, loadEvents, stopPolling]);

  const startPolling = useCallback(() => {
    if (pollerRef.current) return;
    pollTasks();
    pollerRef.current = setInterval(pollTasks, 1500);
  }, [pollTasks]);

  useEffect(() => {
    async function onPageOpen() {
      try {
        setLoading(true);
        await initializeDaily();
        // Fetch today's meetings count
        const count = await getTodayMeetingsCount();
        setMeetingsCount(count);
      } catch (error) {
        console.error("Failed to initialize daily:", error);
      } finally {
        await loadEvents();
        setLoading(false);
      }
    }
    onPageOpen();
  }, [loadEvents]);

  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

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
        setError(error instanceof Error ? error.message : "Failed to send message");

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
    [startPolling]
  );

  const failedTasks = tasks.filter((task) => task.status === "failed");

  const retryTask = useCallback(async (taskId: string) => {
    await fetch(`/api/tasks/${taskId}/retry`, { method: "POST" });
    startPolling();
  }, [startPolling]);

  const cancelTask = useCallback(async (taskId: string) => {
    await fetch(`/api/tasks/${taskId}/cancel`, { method: "POST" });
    startPolling();
  }, [startPolling]);

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
          <DailyEmptyState showDisclaimer={true} meetingsCount={meetingsCount}>
            {failedTasks.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>Some steps failed. You can retry or cancel.</span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retryTask(failedTasks[0].id)}
                    >
                      Retry
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => cancelTask(failedTasks[0].id)}
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
          
             <Calendar className="size-4 text-muted-foreground" /> {format(new Date(today), "EEEE, MMMM d, yyyy")}
      
          </div>
          {failedTasks.length > 0 && (
            <div className="px-6 pt-4">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>Some steps failed. You can retry or cancel.</span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retryTask(failedTasks[0].id)}
                    >
                      Retry
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => cancelTask(failedTasks[0].id)}
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
