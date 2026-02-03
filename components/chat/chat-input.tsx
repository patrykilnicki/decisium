"use client";

import { useState, useRef, useCallback, useEffect, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp, Loader2, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatInputProps } from "./types";

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = "Type a message...",
  isLoading = false,
  variant = "default",
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDisabled = disabled || isSending || isLoading;
  const canSend = message.trim().length > 0 && !isDisabled;
  const isFull = variant === "full";

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const maxH = isFull ? 200 : 200;
      const newHeight = Math.min(textarea.scrollHeight, maxH);
      textarea.style.height = `${newHeight}px`;
    }
  }, [message, isFull]);

  const handleSubmit = useCallback(async () => {
    if (!canSend) return;

    const trimmedMessage = message.trim();
    setIsSending(true);
    setMessage("");

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      await onSend(trimmedMessage);
    } catch (error) {
      console.error("Failed to send message:", error);
      setMessage(trimmedMessage);
    } finally {
      setIsSending(false);
    }
  }, [message, canSend, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  if (isFull) {
    return (
      <div
        className={cn(
          "relative flex w-full flex-col rounded-2xl border border-border/60 bg-background shadow-lg transition-shadow",
        
          isDisabled && "opacity-60"
        )}
      >
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isDisabled}
          rows={3}
          className={cn(
            "min-h-[88px] w-full resize-none border-0 bg-transparent px-4 pt-4 pb-2 text-base md:text-base",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
            "placeholder:text-muted-foreground",
            "scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
          )}
          style={{ maxHeight: "200px" }}
        />
        <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-10 rounded-full bg-muted text-muted-foreground"
            aria-label="Voice input"
          >
            <Mic className="size-5" />
          </Button>
          <Button
            type="button"
            size="icon"
            disabled={!canSend}
            onClick={handleSubmit}
            className="size-10 rounded-full bg-foreground text-background"
            aria-label="Send message"
          >
            {isSending || isLoading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <ArrowUp className="size-5" />
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
   
      <div className="w-full max-w-4xl mx-auto p-4">
        <div
          className={cn(
            "relative flex items-end gap-2 rounded-3xl border border-border/60 bg-background shadow-lg transition-shadow",
            isDisabled && "opacity-60"
          )}
        >
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isDisabled}
            rows={1}
            className={cn(
              "resize-none border-0 bg-transparent",
              "text-base md:text-base px-6 mb-1",
              "focus-visible:ring-0 focus-visible:ring-offset-0",
              "placeholder:text-muted-foreground",
      
            )}
            style={{ minHeight: "44px", maxHeight: "200px" }}
          />

          <div className="flex items-center gap-2 pr-2 py-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-10 rounded-full bg-muted text-muted-foreground"
            aria-label="Voice input"
          >
            <Mic className="size-5" />
          </Button>
          <Button
            type="button"
            size="icon"
            disabled={!canSend}
            onClick={handleSubmit}
            className="size-10 rounded-full bg-foreground text-background"
            aria-label="Send message"
          >
            {isSending || isLoading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <ArrowUp className="size-5" />
            )}
          </Button>
          </div>
        </div>

        <p className="mt-2 text-center text-muted-foreground text-sm">
        The agent could make mistakes. Please report any issue to improve the experience.
        </p>
      </div>
  );
}
