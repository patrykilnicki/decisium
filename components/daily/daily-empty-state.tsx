"use client";

import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReactNode } from "react";

interface DailyEmptyStateProps {
  /** Optional user first name for greeting, e.g. "Patryk" */
  userName?: string | null;
  /** Number of meetings to show in the button (e.g. from calendar). Default 4. */
  meetingsCount?: number;
  /** When false, disclaimer is omitted (e.g. when input + disclaimer are below). Default true. */
  showDisclaimer?: boolean;
  /** Content to render below the meetings button (e.g. chat input) */
  children?: ReactNode;
  className?: string;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function DailyEmptyState({
  userName,
  meetingsCount = 4,
  showDisclaimer = true,
  children,
}: DailyEmptyStateProps) {
  const greeting = getGreeting();
  const greetingLine = userName
    ? `${greeting}, ${userName}!`
    : `${greeting}!`;

  return (

    <div
      className="relative flex min-h-full flex-col items-center justify-start overflow-hidden bg-background p-8 pt-16"
      style={{
        backgroundImage: "url(/bg.svg)",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "top left",
        backgroundSize: "auto 50vh",
      }}
    >
      <div className="relative flex flex-col items-center gap-12 w-full mt-10">

      <div className="relative flex flex-col items-center gap-6 w-full">
        {/* Greeting and main question */}
        <div className="space-y-1 text-center">
          <p className="text-2xl text-muted-foreground">{greetingLine}</p>
          <h2 className="text-3xl font-bold tracking-tight">
            What are your main goals for today?
          </h2>
        </div>
        <Button
          type="button"
          variant="outline"
          size="default"
        >
              {meetingsCount} meeting{meetingsCount !== 1 ? "s" : ""} today
        </Button>
</div>
<div className="relative flex flex-col items-center gap-4 max-w-3xl w-full">
 

        {/* Children (e.g. chat input) rendered below meetings */}
        {children && <div className="w-full">{children}</div>}

        {/* Disclaimer */}
        {showDisclaimer && (
          <p className="text-center text-muted-foreground max-w-xs text-sm">
            The agent could make mistakes. Please report any issue to improve the experience.
          </p>
        )}
      </div>
    </div>
    </div>
 
  );
}
