"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogFooter,
} from "@/components/ui/dialog";
import { getTodayMeetings } from "@/app/actions/daily";
import type { TodayMeeting } from "@/app/actions/daily";
import { format } from "date-fns";

interface DailyEmptyStateProps {
  /** Optional user first name for greeting, e.g. "Patryk" */
  userName?: string | null;
  /** Number of meetings to show in the button (e.g. from calendar). Default 0. */
  meetingsCount?: number;
  /** Client's local date YYYY-MM-DD for "today" (avoids timezone mismatch with server). */
  today?: string;
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

function formatTime(iso: string): string {
  return format(new Date(iso), "h:mm a");
}

function formatDuration(minutes: number | null): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function DailyEmptyState({
  userName,
  meetingsCount = 0,
  today,
  showDisclaimer = true,
  children,
}: DailyEmptyStateProps) {
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  const [meetings, setMeetings] = useState<TodayMeeting[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const dateForMeetings = today ?? format(new Date(), "yyyy-MM-dd");

  const loadMeetings = useCallback(async () => {
    setMeetingsLoading(true);
    try {
      const data = await getTodayMeetings(dateForMeetings);
      setMeetings(data);
    } finally {
      setMeetingsLoading(false);
    }
  }, [dateForMeetings]);

  useEffect(() => {
    if (meetingsOpen) {
      loadMeetings();
    }
  }, [meetingsOpen, loadMeetings]);

  const greeting = getGreeting();
  const greetingLine = userName ? `${greeting}, ${userName}!` : `${greeting}!`;

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
          <div className="space-y-1 text-center">
            <p className="text-2xl text-muted-foreground">{greetingLine}</p>
            <h2 className="text-3xl font-bold tracking-tight">
              What are your main goals for today?
            </h2>
          </div>
          <Dialog open={meetingsOpen} onOpenChange={setMeetingsOpen}>
            <Button
              type="button"
              variant="outline"
              size="default"
              onClick={() => setMeetingsOpen(true)}
            >
              {meetingsCount} meeting{meetingsCount !== 1 ? "s" : ""} today
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Meetings today</DialogTitle>
              </DialogHeader>
              <div className="min-h-[200px] overflow-auto -mx-1 px-1">
                {meetingsLoading ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    Loading…
                  </p>
                ) : meetings.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No meetings today.
                  </p>
                ) : (
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b text-muted-foreground text-left">
                        <th className="py-2 pr-4 font-medium">Time</th>
                        <th className="py-2 pr-4 font-medium">Title</th>
                        <th className="py-2 pr-4 font-medium">Duration</th>
                        <th className="py-2 font-medium">Participants</th>
                      </tr>
                    </thead>
                    <tbody>
                      {meetings.map((m) => (
                        <tr key={m.id} className="border-b last:border-0">
                          <td className="py-2.5 pr-4 whitespace-nowrap">
                            {formatTime(m.occurred_at)}
                          </td>
                          <td className="py-2.5 pr-4">
                            {m.source_url ? (
                              <a
                                href={m.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-foreground underline underline-offset-2 hover:no-underline"
                              >
                                {m.title || "Untitled"}
                              </a>
                            ) : (
                              <span>{m.title || "Untitled"}</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {formatDuration(m.duration_minutes)}
                          </td>
                          <td
                            className="py-2.5 text-muted-foreground max-w-[140px] truncate"
                            title={m.participants?.join(", ")}
                          >
                            {m.participants?.length
                              ? m.participants.join(", ")
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <DialogFooter>
                <DialogClose>Close</DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <div className="relative flex flex-col items-center gap-4 max-w-3xl w-full">
          {children && <div className="w-full">{children}</div>}
          {showDisclaimer && (
            <p className="text-center text-muted-foreground max-w-xs text-sm">
              The agent could make mistakes. Please report any issue to improve
              the experience.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
