"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { ChatContainer, useChat, ChatMessageType } from "@/components/chat";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import Link from "next/link";

interface ApiMessage {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: string;
}

function transformMessage(msg: ApiMessage): ChatMessageType {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    createdAt: msg.created_at,
  };
}

export default function ThreadPage() {
  const params = useParams();
  const threadId = params.threadId as string;
  const [initialLoading, setInitialLoading] = useState(true);

  const {
    messages,
    thinkingState,
    sendMessage,
    isLoading,
    error,
    setMessages,
    tasks,
    retryTask,
    cancelTask,
  } = useChat({
    apiEndpoint: `/api/ask/threads/${threadId}/messages`,
    mode: "task",
    sessionId: threadId,
    tasksEndpoint: "/api/tasks",
    messagesEndpoint: `/api/ask/threads/${threadId}/messages`,
  });

  const loadMessages = useCallback(async () => {
    if (!threadId) return;
    try {
      setInitialLoading(true);
      const response = await fetch(`/api/ask/threads/${threadId}/messages`);
      if (response.ok) {
        const data: ApiMessage[] = await response.json();
        const validMessages = Array.isArray(data)
          ? data
              .filter((msg) => msg != null && msg.role != null)
              .map(transformMessage)
          : [];
        setMessages(validMessages);
      }
    } catch (error) {
      console.error("Failed to load messages:", error);
      setMessages([]);
    } finally {
      setInitialLoading(false);
    }
  }, [threadId, setMessages]);

  // Load initial messages
  useEffect(() => {
    if (threadId) {
      loadMessages();
    }
  }, [threadId, loadMessages]);

  const handleSend = useCallback(
    async (content: string) => {
      await sendMessage(content);
    },
    [sendMessage]
  );

  const failedTasks =
    tasks?.filter((task) => task.status === "failed") ?? [];

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="flex flex-col h-full relative min-h-0">
          {/* Header */}
          <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 z-10 shrink-0">
            <div className="flex items-center gap-4 p-4">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/ask">← Back</Link>
              </Button>
              <h1 className="text-lg font-semibold">Conversation</h1>
            </div>
          </header>

          {/* Chat Area */}
          {initialLoading ? (
            <div className="flex-1 flex items-center justify-center min-h-0">
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <Loader2 className="size-6 animate-spin" />
                <span className="text-sm">Loading messages...</span>
              </div>
            </div>
          ) : (
            <ChatContainer
              messages={messages}
              thinkingState={thinkingState}
              onSend={handleSend}
              isLoading={isLoading}
              placeholder="Ask about your patterns, history, or insights..."
              emptyStateTitle="Start the conversation"
              emptyStateDescription="Ask me anything about your data, patterns, or get insights from your history."
            />
          )}

          {failedTasks.length > 0 && (
            <div className="px-4 pb-4">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>Some steps failed. You can retry or cancel.</span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retryTask?.(failedTasks[0].id)}
                    >
                      Retry
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => cancelTask?.(failedTasks[0].id)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="absolute bottom-20 left-4 right-4 mx-auto max-w-3xl">
              <div className="px-4 py-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">
                {error}
              </div>
            </div>
          )}
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
