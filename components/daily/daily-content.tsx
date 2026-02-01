"use client";

import { useCallback, useEffect, useState } from "react";
import { DailyEvent } from "@/packages/agents/schemas/daily.schema";
import { ChatContainer, ChatMessageType, ThinkingState } from "@/components/chat";
import { format } from "date-fns";
import { initializeDaily } from "@/app/actions/daily";
import { Loader2 } from "lucide-react";

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
  const [thinkingState, setThinkingState] = useState<ThinkingState>({
    isThinking: false,
    steps: [],
  });
  const [error, setError] = useState<string | null>(null);
  const today = format(new Date(), "yyyy-MM-dd");

  const loadEvents = useCallback(async () => {
    try {
      const response = await fetch(`/api/daily/events?date=${today}`);
      if (response.ok) {
        const data: DailyEvent[] = await response.json();
        const transformedMessages = data
          .filter((event) => event != null && event.role != null)
          .map(transformEvent);
        setMessages(transformedMessages);
      }
    } catch (error) {
      console.error("Failed to load events:", error);
      setError("Failed to load messages");
    }
  }, [today]);

  useEffect(() => {
    async function onPageOpen() {
      try {
        setLoading(true);
        await initializeDaily();
      } catch (error) {
        console.error("Failed to initialize daily:", error);
      } finally {
        await loadEvents();
        setLoading(false);
      }
    }
    onPageOpen();
  }, [loadEvents]);

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

      // Show thinking state (will be updated by SSE stream)
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
            Accept: "text/event-stream",
          },
          body: JSON.stringify({ message: content }),
        });

        if (!respondResponse.ok) {
          const errorData = await respondResponse.json();
          throw new Error(errorData.error || "Failed to process message");
        }

        const reader = respondResponse.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6)) as {
                type: string;
                stepId?: string;
                label?: string;
                error?: string;
                response?: string;
              };

              switch (event.type) {
                case "run_started":
                  setThinkingState((prev) => ({
                    ...prev,
                    steps: [],
                  }));
                  break;
                case "step_started": {
                  const stepId = event.stepId;
                  const label = event.label;
                  if (stepId && label) {
                    setThinkingState((prev) => {
                      const exists = prev.steps.some((s) => s.stepId === stepId);
                      if (exists) {
                        return {
                          ...prev,
                          steps: prev.steps.map((s) =>
                            s.stepId === stepId
                              ? { ...s, status: "running" as const }
                              : s
                          ),
                        };
                      }
                      return {
                        ...prev,
                        steps: [
                          ...prev.steps,
                          { stepId, label, status: "running" as const },
                        ],
                      };
                    });
                  }
                  break;
                }
                  break;
                case "step_completed":
                  if (event.stepId) {
                    setThinkingState((prev) => ({
                      ...prev,
                      steps: prev.steps.map((s) =>
                        s.stepId === event.stepId
                          ? { ...s, status: "completed" as const }
                          : s
                      ),
                    }));
                  }
                  break;
                case "run_finished":
                  setThinkingState((prev) => ({
                    ...prev,
                    isThinking: false,
                    steps: prev.steps.map((s) => ({
                      ...s,
                      status: "completed" as const,
                    })),
                  }));
                  break;
                case "run_error":
                  setError(event.error ?? "An error occurred");
                  setThinkingState({
                    isThinking: false,
                    steps: [],
                  });
                  throw new Error(event.error);
              }
            } catch {
              // Ignore parse errors for malformed lines
            }
          }
        }

        // Reload events to get the actual saved messages
        await loadEvents();
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
    [loadEvents]
  );

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 p-4">
          <h1 className="text-xl font-semibold">Daily</h1>
          <p className="text-sm text-muted-foreground">
            {format(new Date(today), "EEEE, MMMM d, yyyy")}
          </p>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
            <span className="text-sm">Loading your daily...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 z-10 p-4">
        <h1 className="text-xl font-semibold">Daily</h1>
        <p className="text-sm text-muted-foreground">
          {format(new Date(today), "EEEE, MMMM d, yyyy")}
        </p>
      </header>

      <ChatContainer
        messages={messages}
        thinkingState={thinkingState}
        onSend={handleSend}
        isLoading={thinkingState.isThinking}
        placeholder="Write your thoughts, plans, or ask a question..."
        emptyStateTitle="Good morning!"
        emptyStateDescription="Share what's on your mind, your plans for today, or ask me anything."
      />

      {/* Error display */}
      {error && (
        <div className="absolute bottom-20 left-4 right-4 mx-auto max-w-3xl">
          <div className="px-4 py-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">
            {error}
          </div>
        </div>
      )}
    </div>
  );
}
