"use client";

import { memo } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sparkles, User } from "lucide-react";
import type { ChatMessage as ChatMessageType, ChatMessageProps } from "./types";

function ChatMessageComponent({
  message,
  showAvatar = true,
  isStreaming = false,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isSystem = message.role === "system";

  return (
    <div
      className={cn(
        "flex w-full gap-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-300",
        isUser && "flex-row-reverse",
        isSystem && "justify-center"
      )}
    >
      {/* Avatar */}
      {showAvatar && !isSystem && (
        <div className="flex-shrink-0">
          <Avatar size="sm">
            <AvatarFallback
              className={cn(
                isAssistant && "bg-primary text-primary-foreground"
              )}
            >
              {isUser ? (
                <User className="size-3.5" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
            </AvatarFallback>
          </Avatar>
        </div>
      )}

      {/* Message Content */}
      <div
        className={cn(
          "flex flex-col gap-1",
          isUser && "items-end",
          isSystem && "items-center",
          !isSystem && "max-w-[85%] sm:max-w-[75%]"
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5",
            isUser && "bg-primary text-primary-foreground rounded-br-md",
            isAssistant && "bg-muted rounded-bl-md",
            isSystem && "bg-muted/50 text-muted-foreground text-sm px-3 py-1.5",
            isStreaming && "animate-pulse"
          )}
        >
          <div
            className={cn(
              "whitespace-pre-wrap break-words text-sm leading-relaxed",
              isUser && "text-primary-foreground"
            )}
          >
            {message.content}
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 ml-0.5 bg-current animate-pulse rounded-sm" />
            )}
          </div>
        </div>

        {/* Timestamp */}
        {message.createdAt && !isSystem && (
          <span
            className={cn(
              "text-[10px] text-muted-foreground/70 px-1",
              isUser && "text-right"
            )}
          >
            {format(new Date(message.createdAt), "h:mm a")}
          </span>
        )}
      </div>
    </div>
  );
}

// Memoize to prevent unnecessary re-renders
export const ChatMessage = memo(ChatMessageComponent, (prev, next) => {
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.isStreaming === next.isStreaming
  );
});

ChatMessage.displayName = "ChatMessage";
