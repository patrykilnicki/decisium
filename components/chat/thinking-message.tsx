"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Loader2, Check, AlertCircle } from "lucide-react";
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
      return <Loader2 className="size-4 animate-spin text-primary" />;
    case "completed":
      return <Check className="size-4 text-green-500" />;
    case "error":
      return <AlertCircle className="size-4 text-destructive" />;
    default:
      return null;
  }
}

function CurrentStep({ step }: { step: ThinkingStep }) {
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
  // Find the current active step (running step, or last completed step if no running step)
  const currentStep = useMemo(() => {
    if (steps.length === 0) return null;

    // First, try to find a running step
    const runningStep = steps.find((step) => step.status === "running");
    if (runningStep) return runningStep;

    // If no running step, find the last completed step
    const completedSteps = steps.filter((step) => step.status === "completed");
    if (completedSteps.length > 0) {
      // Return the last completed step (highest index)
      return completedSteps[completedSteps.length - 1];
    }

    // If no completed steps, return the first pending step
    const pendingStep = steps.find((step) => step.status === "pending");
    return pendingStep || null;
  }, [steps]);

  if (!isVisible) return null;

  return (
    <div className="flex w-full gap-6 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      {/* Avatar */}
      <div className="flex-shrink-0">
        <AnimatedSystemAvatar size="default" />
      </div>

      {/* Thinking Content */}
      <div className="flex flex-col gap-2 max-w-[85%] sm:max-w-[75%]">
        {/* Always show "Thinking..." */}
        <div className="rounded-2xl">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              Thinking...
            </span>

            {/* Show current step below "Thinking..." */}
            {currentStep && <CurrentStep step={currentStep} />}

            {/* Loading indicator when no steps yet */}
            {!currentStep && steps.length === 0 && !streamedContent && (
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
