"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { CentralIcon } from "@/components/ui/central-icon";
import { MarkdownContent } from "./markdown-content";
import { AnimatedSystemAvatar } from "./animated-system-avatar";
import type {
  ThinkingMessageProps,
  ThinkingStep,
  ThinkingStepStatus,
} from "./types";

function StepIcon({ status }: { status: ThinkingStepStatus }) {
  switch (status) {
    case "running":
      return (
        <CentralIcon
          name="IconLoader"
          size={16}
          className="animate-spin text-primary"
        />
      );
    case "completed":
      return (
        <CentralIcon
          name="IconCheckmark1"
          size={16}
          className="text-green-500"
        />
      );
    case "error":
      return (
        <CentralIcon
          name="IconBubbleAlert"
          size={16}
          className="text-destructive"
        />
      );
    default:
      return null;
  }
}

function StepRow({ step }: { step: ThinkingStep }) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
      <StepIcon status={step.status} />
      <span
        className={cn(
          "transition-colors duration-300",
          step.status === "completed" && "text-muted-foreground",
          step.status === "running" && "text-foreground",
          step.status === "error" && "text-destructive",
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
    <div className="flex w-full gap-6 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      {/* Avatar */}
      <div className="flex-shrink-0">
        <AnimatedSystemAvatar size="default" />
      </div>

      {/* Thinking Content */}
      <div className="flex flex-col gap-2 max-w-[85%] sm:max-w-[75%]">
        <div className="rounded-2xl">
          <div className="flex flex-col gap-2">
            {/* Persistent top-to-bottom steps list */}
            {steps.length > 0 &&
              steps.map((step) => <StepRow key={step.stepId} step={step} />)}

            {steps.length === 0 && (
              <span className="text-sm font-medium text-muted-foreground">
                Thinking...
              </span>
            )}

            {/* Loading indicator when no steps yet */}
            {steps.length === 0 && !streamedContent && (
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="size-4 bg-foreground/30 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <span className="size-4 bg-foreground/30 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <span className="size-4 bg-foreground/30 rounded-full animate-bounce" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Streamed Content Preview */}
        {streamedContent && (
          <div className="rounded-2xl">
            <MarkdownContent content={streamedContent} className="text-sm" />
            <span className="inline-block w-1.5 h-4 ml-0.5 bg-foreground/70 animate-pulse rounded-sm" />
          </div>
        )}
      </div>
    </div>
  );
}

export const ThinkingMessage = memo(ThinkingMessageComponent);

ThinkingMessage.displayName = "ThinkingMessage";
