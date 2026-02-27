"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CentralIcon } from "@/components/ui/central-icon";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface HomeContentProps {
  userName: string | null;
  userId: string | null;
}

interface CalendarEvent {
  id: string;
  title: string;
  time: string;
  color: "indigo" | "green";
}

interface CalendarEventRow {
  id: string;
  title: string | null;
  occurred_at: string;
  duration_minutes: number | null;
  categories: string[] | null;
}

interface IntegrationTodoItem {
  id: string;
  title: string;
  summary: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "done";
  dueAt: string | null;
}

interface IntegrationTodoListResponse {
  items: IntegrationTodoItem[];
}

const JOURNAL_ENTRIES = [
  {
    id: "1",
    time: "12:34",
    text: "The FAQ agent performs well with structured knowledge, but struggles when questions mix booking and pricing. We may need intent pre-classification before routing.",
  },
  {
    id: "2",
    time: "10:45",
    text: "We could create a weekly intelligence summary that highlights trends across conversations and bookings.",
  },
  {
    id: "3",
    time: "09:35",
    text: "New page of FAQ doesnt make sense. Better is creating a new one",
    comment: "Notion comment",
  },
];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatDisplayDate(date: Date) {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTimeRange(
  occurredAt: string,
  durationMinutes: number | null,
): string {
  const start = new Date(occurredAt);
  const startStr = start.toLocaleTimeString("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  if (durationMinutes == null || durationMinutes <= 0) {
    return startStr;
  }
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const endStr = end.toLocaleTimeString("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${startStr} - ${endStr}`;
}

function getEventColor(
  title: string | null,
  categories: string[] | null,
): "indigo" | "green" {
  const t = (title ?? "").toLowerCase();
  const cats = (categories ?? []).map((c) => c.toLowerCase());
  if (
    t.includes("deep work") ||
    t.includes("focus") ||
    t.includes("block") ||
    cats.some((c) => c.includes("focus") || c.includes("deep"))
  ) {
    return "green";
  }
  return "indigo";
}

function isSameDay(dateA: Date, dateB: Date): boolean {
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
}

export function HomeContent({ userName, userId }: HomeContentProps) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [journalValue, setJournalValue] = useState("");
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [integrationTasks, setIntegrationTasks] = useState<
    IntegrationTodoItem[]
  >([]);
  const [tasksLoading, setTasksLoading] = useState(false);

  const displayName =
    typeof userName === "string" && userName !== "there"
      ? userName.split(" ")[0]
      : (userName ?? "there");

  function goPrevDay() {
    setSelectedDate((d) => {
      const next = new Date(d);
      next.setDate(next.getDate() - 1);
      return next;
    });
  }

  function goNextDay() {
    setSelectedDate((d) => {
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      return next;
    });
  }

  useEffect(() => {
    if (!userId) {
      queueMicrotask(() => setCalendarEvents([]));
      return;
    }

    async function fetchCalendarEvents() {
      if (!userId) return;
      setCalendarLoading(true);
      const supabase = createClient();
      const start = new Date(selectedDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(selectedDate);
      end.setDate(end.getDate() + 1);
      end.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from("activity_atoms")
        .select("id, title, occurred_at, duration_minutes, categories")
        .eq("user_id", userId)
        .eq("atom_type", "event")
        .gte("occurred_at", start.toISOString())
        .lt("occurred_at", end.toISOString())
        .order("occurred_at", { ascending: true });

      if (error) {
        console.error("[HomeContent] Failed to fetch calendar events:", error);
        setCalendarEvents([]);
      } else {
        const events: CalendarEvent[] = (
          (data ?? []) as CalendarEventRow[]
        ).map((row) => ({
          id: row.id,
          title: row.title ?? "Untitled event",
          time: formatTimeRange(row.occurred_at, row.duration_minutes),
          color: getEventColor(row.title, row.categories),
        }));
        setCalendarEvents(events);
      }
      setCalendarLoading(false);
    }

    fetchCalendarEvents();
  }, [userId, selectedDate]);

  useEffect(() => {
    if (!userId) {
      queueMicrotask(() => setIntegrationTasks([]));
      return;
    }

    async function fetchTasks() {
      setTasksLoading(true);
      try {
        const response = await fetch(
          "/api/integrations/todos?mode=smart&persist=true&maxItems=100",
          { method: "GET", cache: "no-store" },
        );
        if (!response.ok) {
          setIntegrationTasks([]);
          return;
        }
        const payload =
          (await response.json()) as Partial<IntegrationTodoListResponse>;
        setIntegrationTasks(Array.isArray(payload.items) ? payload.items : []);
      } catch {
        setIntegrationTasks([]);
      } finally {
        setTasksLoading(false);
      }
    }

    fetchTasks();
  }, [userId]);

  const today = new Date();
  const selectedIsToday = isSameDay(selectedDate, today);
  const visibleTasks = integrationTasks.filter((task) => {
    if (!task.dueAt) return selectedIsToday;
    const dueDate = new Date(task.dueAt);
    if (Number.isNaN(dueDate.getTime())) return selectedIsToday;
    return isSameDay(dueDate, selectedDate);
  });

  return (
    <div className="flex flex-1 flex-col items-center gap-14 px-4 py-8 md:px-8 lg:px-32">
      {/* Header: greeting + date navigation */}
      <header className="flex w-full max-w-[720px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[28px] md:leading-9">
          {getGreeting()}, {displayName}
        </h1>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-9 rounded-xl shadow-sm"
            onClick={goPrevDay}
            aria-label="Previous day"
          >
            <CentralIcon
              name="IconChevronLeft"
              iconFill="outlined"
              iconStroke="2"
              size={20}
            />
          </Button>
          <div className="rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-sm">
            {formatDisplayDate(selectedDate)}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="size-9 rounded-xl shadow-sm"
            onClick={goNextDay}
            aria-label="Next day"
          >
            <CentralIcon
              name="IconChevronRight"
              iconFill="outlined"
              iconStroke="2"
              size={20}
            />
          </Button>
        </div>
      </header>

      {/* Tasks section */}
      <section className="flex w-full max-w-[720px] flex-col gap-4">
        <h2 className="text-lg font-bold leading-8 tracking-tight text-foreground">
          Tasks
        </h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {tasksLoading ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">
              Loading tasks...
            </p>
          ) : visibleTasks.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">
              No tasks for this day
            </p>
          ) : (
            visibleTasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-5 border-b border-border px-5 py-4 last:border-b-0"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <div
                    className="size-[18px] shrink-0 rounded-[6px] border-[1.5px] border-input"
                    aria-hidden
                  />
                  <span className="truncate text-sm font-medium text-foreground">
                    {task.title}
                  </span>
                </div>
                {task.priority === "urgent" || task.priority === "high" ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <CentralIcon
                      name="IconWarningSign"
                      iconFill="outlined"
                      iconStroke="2"
                      size={16}
                      className="text-destructive"
                    />
                    <span className="text-[13px] font-medium tracking-tight text-destructive">
                      {task.priority === "urgent" ? "Urgent" : "High priority"}
                    </span>
                  </div>
                ) : (
                  <div className="size-[18px] shrink-0 text-muted-foreground">
                    <CentralIcon
                      name="IconNote1"
                      iconFill="outlined"
                      iconStroke="2"
                      size={18}
                    />
                  </div>
                )}
              </div>
            ))
          )}
          <button
            type="button"
            className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-normal text-muted-foreground transition-colors hover:bg-muted/50"
          >
            <div className="flex size-[18px] items-center justify-center rounded-[6px] border border-input">
              <CentralIcon
                name="IconPlusSmall"
                iconFill="outlined"
                iconStroke="2"
                size={16}
              />
            </div>
            New task
          </button>
        </div>
      </section>

      {/* Calendar section */}
      <section className="flex w-full max-w-[720px] flex-col gap-4">
        <h2 className="text-lg font-bold leading-8 tracking-tight text-foreground">
          Calendar
        </h2>
        <div className="flex flex-col gap-1">
          {calendarLoading ? (
            <p className="py-4 text-sm text-muted-foreground">
              Loading calendar...
            </p>
          ) : calendarEvents.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No events for this day
            </p>
          ) : (
            calendarEvents.map((event) => (
              <div
                key={event.id}
                className={cn(
                  "flex gap-3 rounded-xl px-2 py-2",
                  event.color === "green"
                    ? "bg-emerald-500/10"
                    : "bg-primary/5",
                )}
              >
                <div
                  className={cn(
                    "w-[3px] shrink-0 self-stretch rounded",
                    event.color === "green" ? "bg-emerald-600" : "bg-primary",
                  )}
                />
                <div className="flex min-w-0 flex-1 flex-col justify-center py-0.5">
                  <p className="text-sm font-medium leading-5 text-foreground">
                    {event.title}
                  </p>
                  <p className="text-xs leading-4 tracking-wide text-muted-foreground">
                    {event.time}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Journal section */}
      <section className="flex w-full max-w-[720px] flex-col gap-4">
        <h2 className="text-lg font-bold leading-8 tracking-tight text-foreground">
          Journal
        </h2>
        <div className="flex flex-col gap-4 rounded-[20px] border border-border bg-card p-4 shadow-sm">
          <div className="min-h-[52px] rounded-lg p-2">
            <Textarea
              placeholder="Add notes, ideas or reflections"
              value={journalValue}
              onChange={(e) => setJournalValue(e.target.value)}
              className="min-h-[80px] resize-none border-0 bg-transparent text-sm placeholder:text-muted-foreground focus-visible:ring-0"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="icon"
                className="size-8 rounded-full"
                aria-label="Voice input"
              >
                <CentralIcon
                  name="IconMicrophone"
                  iconFill="outlined"
                  iconStroke="2"
                  size={20}
                />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="rounded-full px-3 py-1.5 text-[13px] font-medium"
              >
                Generate from App Stack
              </Button>
            </div>
            <Button
              size="icon"
              className="size-8 rounded-full opacity-50"
              aria-label="Send"
            >
              <CentralIcon
                name="IconArrowUp"
                iconFill="filled"
                iconStroke="2"
                size={20}
                className="text-primary-foreground"
              />
            </Button>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {JOURNAL_ENTRIES.map((entry) => (
            <div
              key={entry.id}
              className="flex gap-5 border-b border-border px-5 py-4 last:border-b-0"
            >
              <p className="w-12 shrink-0 text-sm font-medium text-muted-foreground">
                {entry.time}
              </p>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-sm font-normal leading-5 text-foreground">
                  {entry.text}
                </p>
                {entry.comment && (
                  <div className="flex items-center gap-2">
                    <CentralIcon
                      name="IconNote1"
                      iconFill="outlined"
                      iconStroke="2"
                      size={16}
                      className="text-muted-foreground"
                    />
                    <span className="text-xs font-medium tracking-wide text-muted-foreground">
                      {entry.comment}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
