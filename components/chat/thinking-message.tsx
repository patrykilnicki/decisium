"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sparkles, Loader2, Check, Circle, AlertCircle } from "lucide-react";
import type { ThinkingMessageProps, ThinkingStep, ThinkingStepStatus } from "./types";

function StepIcon({ status }: { status: ThinkingStepStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="size-3 animate-spin text-primary" />;
    case "completed":
      return <Check className="size-3 text-green-500" />;
    case "error":
      return <AlertCircle className="size-3 text-destructive" />;
    default:
      return <Circle className="size-3 text-muted-foreground/40" />;
  }
}

function StepItem({ step }: { step: ThinkingStep }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <StepIcon status={step.status} />
      <span
        className={cn(
          "transition-colors duration-200",
          step.status === "completed" && "text-muted-foreground",
          step.status === "running" && "text-foreground font-medium",
          step.status === "pending" && "text-muted-foreground/60",
          step.status === "error" && "text-destructive"
        )}
      >
        {step.label}
      </span>
    </div>
  );
}

function ThinkingMessageComponent({
  steps,
  streamedContent,
  isVisible,
}: ThinkingMessageProps) {
  if (!isVisible) return null;

  return (
    <div className="flex w-full gap-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      {/* Avatar */}
      <div className="flex-shrink-0">
        <Avatar size="sm">
          <AvatarFallback className="bg-primary text-primary-foreground">
            <Sparkles className="size-3.5 animate-pulse" />
          </AvatarFallback>
        </Avatar>
      </div>

      {/* Thinking Content */}
      <div className="flex flex-col gap-2 max-w-[85%] sm:max-w-[75%]">
        {/* Steps Panel */}
        {steps.length > 0 && (
          <div className="rounded-2xl rounded-bl-md bg-muted/50 border border-border/50 px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="size-3.5 animate-spin text-primary" />
              <span className="text-xs font-medium text-muted-foreground">
                Thinking...
              </span>
            </div>
            <div className="space-y-1.5">
              {steps.map((step) => (
                <StepItem key={step.stepId} step={step} />
              ))}
            </div>
          </div>
        )}

        {/* Streamed Content Preview */}
        {streamedContent && (
          <div className="rounded-2xl rounded-bl-md bg-muted px-4 py-2.5">
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {streamedContent}
              <span className="inline-block w-1.5 h-4 ml-0.5 bg-foreground/70 animate-pulse rounded-sm" />
            </div>
          </div>
        )}

        {/* Loading indicator when no steps yet */}
        {steps.length === 0 && !streamedContent && (
          <div className="rounded-2xl rounded-bl-md bg-muted px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                <span className="size-2 bg-foreground/30 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="size-2 bg-foreground/30 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="size-2 bg-foreground/30 rounded-full animate-bounce" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const ThinkingMessage = memo(ThinkingMessageComponent);

ThinkingMessage.displayName = "ThinkingMessage";
