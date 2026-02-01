"use client";

import { useState, useCallback, useRef } from "react";
import type {
  ChatMessage,
  ThinkingState,
  ThinkingStep,
  StreamEvent,
  UseChatConfig,
  UseChatReturn,
} from "./types";

const initialThinkingState: ThinkingState = {
  isThinking: false,
  steps: [],
  streamedContent: undefined,
};

export function useChat({
  apiEndpoint,
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
  const abortControllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setMessages(initialMessages);
    setThinkingState(initialThinkingState);
    setIsLoading(false);
    setError(null);
  }, [initialMessages]);

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
                    : s
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
                : s
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
              s.stepId === errorStepId
                ? { ...s, status: "error" as const }
                : s
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
            s.status === "running"
              ? { ...s, status: "completed" as const }
              : s
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
                      : m
                  )
                );
              }

              if (event.assistantMessage) {
                setMessages((prev) => {
                  // Check if assistant message already exists
                  const exists = prev.some(
                    (m) => m.id === event.assistantMessage!.id
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
        setThinkingState((prev) => ({
          ...prev,
          isThinking: false,
        }));
      }
    },
    [apiEndpoint, handleStreamEvent, onMessageSent, onMessageReceived, onError]
  );

  return {
    messages,
    thinkingState,
    sendMessage,
    isLoading,
    error,
    reset,
    setMessages,
  };
}
