"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  ChatContainer,
  useChat,
  ChatMessageType,
  type ChatRole,
} from "@/components/chat";
import { Button } from "@/components/ui/button";
import { CentralIcon } from "@/components/ui/central-icon";
import { useAskLayout } from "@/app/ask/ask-layout-context";
import type { AskMessage } from "@/types/database";
import { AgentUiRenderer } from "@/components/agent-ui";
import type { TaskApprovalCardProps } from "@/packages/agents/schemas/agent-ui.schema";

function transformMessage(msg: AskMessage): ChatMessageType {
  return {
    id: msg.id,
    role: msg.role as ChatRole,
    content: msg.content,
    createdAt: msg.created_at ?? undefined,
  };
}

export default function ThreadPage() {
  const params = useParams();
  const threadId = params.threadId as string;
  const { threads } = useAskLayout();

  const [initialLoading, setInitialLoading] = useState(true);
  const [submittingProposalId, setSubmittingProposalId] = useState<
    string | null
  >(null);

  const {
    messages,
    thinkingState,
    sendMessage,
    isLoading,
    error,
    setMessages,
    failedTaskIds,
    retryTask,
    cancelTask,
    resumeTask,
    pendingApprovalCards,
    submitApprovalDecision,
  } = useChat({
    apiEndpoint: `/api/ask/threads/${threadId}/messages`,
    mode: "task",
    sessionId: threadId,
    tasksEndpoint: "/api/tasks/events",
    messagesEndpoint: `/api/ask/threads/${threadId}/messages`,
  });

  const loadMessages = useCallback(async () => {
    if (!threadId) return;
    try {
      setInitialLoading(true);
      const response = await fetch(`/api/ask/threads/${threadId}/messages`);
      if (response.ok) {
        const data: AskMessage[] = await response.json();
        const validMessages = Array.isArray(data)
          ? data
              .filter((msg) => msg != null && msg.role != null)
              .map(transformMessage)
          : [];
        setMessages(validMessages);
      }
    } catch (err) {
      console.error("Failed to load messages:", err);
      setMessages([]);
    } finally {
      setInitialLoading(false);
    }
  }, [threadId, setMessages]);

  useEffect(() => {
    if (threadId) loadMessages();
  }, [threadId, loadMessages]);

  const handleSend = useCallback(
    async (content: string) => {
      await sendMessage(content);
    },
    [sendMessage],
  );

  const handleApprove = useCallback(
    async (taskId: string, proposalId: string) => {
      setSubmittingProposalId(proposalId);
      try {
        await submitApprovalDecision({
          taskId,
          proposalId,
          decision: "approve",
        });
      } finally {
        setSubmittingProposalId(null);
      }
    },
    [submitApprovalDecision],
  );

  const handleReject = useCallback(
    async (taskId: string, proposalId: string) => {
      setSubmittingProposalId(proposalId);
      try {
        await submitApprovalDecision({
          taskId,
          proposalId,
          decision: "reject",
        });
      } finally {
        setSubmittingProposalId(null);
      }
    },
    [submitApprovalDecision],
  );

  const handleEditApprove = useCallback(
    async (
      taskId: string,
      proposalId: string,
      props: TaskApprovalCardProps,
    ) => {
      setSubmittingProposalId(proposalId);
      try {
        await submitApprovalDecision({
          taskId,
          proposalId,
          decision: "edit",
          editedProps: props,
        });
      } finally {
        setSubmittingProposalId(null);
      }
    },
    [submitApprovalDecision],
  );

  const failedTasks = failedTaskIds ?? [];
  const currentThread = threads.find((t) => t.id === threadId);
  const threadTitle = currentThread?.title || "Untitled Conversation";

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border bg-background px-4 py-3">
        <h1 className="truncate text-lg font-semibold text-foreground">
          {threadTitle}
        </h1>
      </header>
      {initialLoading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <CentralIcon name="IconLoader" size={24} className="animate-spin" />
            <span className="text-sm">Loading messages...</span>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ChatContainer
            messages={messages}
            thinkingState={thinkingState}
            onSend={handleSend}
            isLoading={isLoading}
            placeholder="Ask about your patterns, history, or insights..."
            inlineContent={
              <AgentUiRenderer
                cards={pendingApprovalCards}
                submittingProposalId={submittingProposalId}
                onApprove={handleApprove}
                onReject={handleReject}
                onEditApprove={handleEditApprove}
              />
            }
          />
        </div>
      )}

      {failedTasks.length > 0 && (
        <div className="pointer-events-none absolute bottom-20 left-4 right-4 z-10 mx-auto max-w-3xl">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>Some steps failed. You can retry, resume, or cancel.</span>
              <div className="pointer-events-auto flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => retryTask?.(failedTasks[0])}
                >
                  Retry
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => resumeTask?.(failedTasks[0])}
                >
                  Resume
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => cancelTask?.(failedTasks[0])}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute bottom-20 left-4 right-4 z-10 mx-auto max-w-3xl">
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        </div>
      )}
    </div>
  );
}
