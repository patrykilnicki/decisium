"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowDown, MessageSquare } from "lucide-react";
import { ChatMessage } from "./chat-message";
import { ThinkingMessage } from "./thinking-message";
import { ChatInput } from "./chat-input";
import type { ChatContainerProps } from "./types";

export function ChatContainer({
  messages,
  thinkingState,
  onSend,
  isLoading = false,
  placeholder = "Type a message...",
  emptyStateTitle = "Start a conversation",
  emptyStateDescription = "Send a message to begin.",
  emptyState,
}: ChatContainerProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);

  // Check if user is near the bottom of the scroll area
  const checkScrollPosition = useCallback(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollArea;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const nearBottom = distanceFromBottom < 100;

    setIsNearBottom(nearBottom);
    setShowScrollButton(!nearBottom && messages.length > 0);
  }, [messages.length]);

  // Auto-scroll to bottom when new messages arrive (if user is near bottom)
  useEffect(() => {
    if (isNearBottom && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, thinkingState?.isThinking, isNearBottom]);

  // Scroll to bottom immediately on initial load
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "instant" });
    }
  }, []);

  // Handle scroll events
  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;

    scrollArea.addEventListener("scroll", checkScrollPosition);
    return () => scrollArea.removeEventListener("scroll", checkScrollPosition);
  }, [checkScrollPosition]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const isEmpty = messages.length === 0 && !thinkingState?.isThinking;

  return (
    <div className="flex flex-col h-full min-h-0">
      
      {/* Messages Area */}
      <div
        ref={scrollAreaRef}
        className="flex-1 overflow-y-auto scroll-smooth min-h-0"
      >
        {isEmpty ? (
          // Empty State (custom or default)
          emptyState ?? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <div className="size-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <MessageSquare className="size-8 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-semibold mb-2">{emptyStateTitle}</h2>
              <p className="text-muted-foreground text-sm max-w-sm">
                {emptyStateDescription}
              </p>
            </div>
          )
        ) : (
          // Messages List
          <div className="max-w-4xl mx-auto p-4 space-y-4">
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}

            {/* Thinking/Loading State as inline message */}
            {thinkingState && (
              <ThinkingMessage
                steps={thinkingState.steps}
                streamedContent={thinkingState.streamedContent}
                isVisible={thinkingState.isThinking}
              />
            )}

            {/* Scroll anchor */}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Scroll to Bottom Button */}
      {showScrollButton && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10">
          <Button
            variant="secondary"
            size="sm"
            onClick={scrollToBottom}
            className="rounded-full shadow-lg gap-1"
          >
            <ArrowDown className="size-3.5" />
            <span className="text-xs">New messages</span>
          </Button>
        </div>
      )}

      {/* Input Area */}
      <ChatInput
        onSend={onSend}
        disabled={false}
        isLoading={isLoading || thinkingState?.isThinking}
        placeholder={placeholder}
      />
    </div>
  );
}
