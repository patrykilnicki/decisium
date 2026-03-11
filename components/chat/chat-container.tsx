"use client";

import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { CentralIcon } from "@/components/ui/central-icon";
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
  inlineContent,
}: ChatContainerProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastUserMessageRef = useRef<HTMLDivElement>(null);
  const lastAutoFocusedUserMessageIdRef = useRef<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);

  const lastUserMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user") return messages[i].id;
    }
    return null;
  }, [messages]);

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
    if (isNearBottom && bottomRef.current && !thinkingState?.isThinking) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, thinkingState?.isThinking, isNearBottom]);

  // On each new user turn, pin their last message near top while assistant is generating.
  useEffect(() => {
    if (!thinkingState?.isThinking) return;
    if (!lastUserMessageId || !lastUserMessageRef.current) return;
    if (lastAutoFocusedUserMessageIdRef.current === lastUserMessageId) return;

    lastUserMessageRef.current.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    lastAutoFocusedUserMessageIdRef.current = lastUserMessageId;
  }, [thinkingState?.isThinking, lastUserMessageId]);

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
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Messages Area */}
      <div
        ref={scrollAreaRef}
        className="flex-1 overflow-y-auto scroll-smooth min-h-0"
      >
        {isEmpty ? (
          <div className="flex-1 min-h-0" />
        ) : (
          // Messages List
          <div className="max-w-4xl mx-auto p-4 space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                ref={
                  message.id === lastUserMessageId ? lastUserMessageRef : null
                }
              >
                <ChatMessage message={message} />
              </div>
            ))}

            {/* Thinking/Loading State as inline message */}
            {thinkingState && (
              <ThinkingMessage
                steps={thinkingState.steps}
                streamedContent={thinkingState.streamedContent}
                isVisible={
                  thinkingState.isThinking ||
                  thinkingState.steps.length > 0 ||
                  Boolean(thinkingState.streamedContent)
                }
              />
            )}

            {inlineContent}

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
            <CentralIcon name="IconArrowDown" size={14} />
            <span className="text-xs">New messages</span>
          </Button>
        </div>
      )}

      {/* Input Area — fixed at bottom, not scrollable */}
      <div className="shrink-0">
        <ChatInput
          onSend={onSend}
          disabled={false}
          isLoading={isLoading || thinkingState?.isThinking}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}
