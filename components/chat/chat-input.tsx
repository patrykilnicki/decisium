"use client";

import { useState, useRef, useCallback, useEffect, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatInputProps } from "./types";

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = "Type a message...",
  isLoading = false,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDisabled = disabled || isSending || isLoading;
  const canSend = message.trim().length > 0 && !isDisabled;

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const newHeight = Math.min(textarea.scrollHeight, 200);
      textarea.style.height = `${newHeight}px`;
    }
  }, [message]);

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
      // Restore message on error
      setMessage(trimmedMessage);
    } finally {
      setIsSending(false);
    }
  }, [message, canSend, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Send on Enter (without Shift)
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <div className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="max-w-3xl mx-auto p-4">
        <div
          className={cn(
            "relative flex items-end gap-2 rounded-2xl border bg-background shadow-sm transition-shadow",
            "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
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
              "flex-1 resize-none border-0 bg-transparent px-4 py-3 text-sm",
              "focus-visible:ring-0 focus-visible:ring-offset-0",
              "placeholder:text-muted-foreground/60",
              "scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
            )}
            style={{ minHeight: "44px", maxHeight: "200px" }}
          />

          <div className="flex items-center gap-2 pr-2 pb-2">
            <Button
              type="button"
              size="icon"
              disabled={!canSend}
              onClick={handleSubmit}
              className={cn(
                "size-8 rounded-lg transition-all",
                canSend
                  ? "bg-primary hover:bg-primary/90"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {isSending || isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
              <span className="sr-only">Send message</span>
            </Button>
          </div>
        </div>

        <p className="mt-2 text-center text-[10px] text-muted-foreground/60">
          Press Enter to send, Shift + Enter for new line
        </p>
      </div>
    </div>
  );
}
