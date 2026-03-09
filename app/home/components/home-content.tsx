"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CentralIcon } from "@/components/ui/central-icon";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useSupabaseRealtime } from "@/lib/realtime";
import { createClient } from "@/lib/supabase/client";
import * as db from "@/lib/supabase/db";
import { cn } from "@/lib/utils";
import { TasksSectionSkeleton } from "@/app/home/components/tasks-section-skeleton";
import { CalendarSectionSkeleton } from "@/app/home/components/calendar-section-skeleton";

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
  priority: "normal" | "urgent";
  /** When priority is urgent, short reason (e.g. Anna waiting for new version). */
  urgentReason?: string;
  status: "open" | "in_progress" | "done";
  dueAt: string | null;
  sourceProvider?: string;
  sourceType?: string;
  /** Link to source (e.g. Gmail thread URL); externalId from triage; sender for Gmail. */
  sourceRef?: {
    sourceUrl?: string;
    externalId?: string;
    sender?: string;
  };
  actionabilityEvidence?: string | null;
  confidence?: number | null;
  suggestedNextAction?: string;
  tags?: string[] | null;
}

/** Task that may be from a past day (overdue); snapshotDate is set for overdue items. */
type TodoItemWithMeta = IntegrationTodoItem & { snapshotDate?: string };

const PRIORITY_ORDER: Record<IntegrationTodoItem["priority"], number> = {
  urgent: 0,
  normal: 1,
};

function sortTasksByPriority<T extends IntegrationTodoItem>(tasks: T[]): T[] {
  return [...tasks].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  );
}

/** Sort merged list: overdue first (oldest first), then by priority within group. */
function sortMergedTasks(
  tasks: TodoItemWithMeta[],
  selectedDateStr: string,
): TodoItemWithMeta[] {
  return [...tasks].sort((a, b) => {
    const aOverdue =
      a.snapshotDate != null && a.snapshotDate !== selectedDateStr;
    const bOverdue =
      b.snapshotDate != null && b.snapshotDate !== selectedDateStr;
    if (aOverdue && !bOverdue) return -1;
    if (!aOverdue && bOverdue) return 1;
    if (aOverdue && bOverdue) {
      const dateCmp = (a.snapshotDate ?? "").localeCompare(
        b.snapshotDate ?? "",
      );
      if (dateCmp !== 0) return dateCmp;
    }
    return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  });
}

interface IntegrationTodoListResponse {
  items: IntegrationTodoItem[];
  hasSnapshot?: boolean;
}

/** Normalize priority from API (supports legacy low/medium/high -> normal). */
function normalizeTodoItem(item: IntegrationTodoItem): IntegrationTodoItem {
  const p = item.priority;
  const priority: IntegrationTodoItem["priority"] =
    p === "urgent" ? "urgent" : "normal";
  return {
    ...item,
    priority,
    urgentReason:
      "urgentReason" in item && typeof item.urgentReason === "string"
        ? item.urgentReason
        : undefined,
  };
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

/** Normalize sender string to email for block list (e.g. "Name <a@b.com>" → "a@b.com"). */
function normalizeSenderToEmail(sender: string): string {
  const s = sender.trim();
  if (s.includes("<") && s.includes(">")) {
    const match = s.match(/<([^>]+)>/);
    return match ? match[1].trim().toLowerCase() : s.toLowerCase();
  }
  return s.toLowerCase();
}

interface TaskRowProps {
  task: TodoItemWithMeta;
  date: string;
  isOverdue: boolean;
  onOpenDetail: () => void;
  onActionOpen: (type: "date" | "name") => void;
  onMarkResolved: () => void;
  onMarkUnresolved: () => void;
  onDelete: () => void;
  onBlockSender?: (sender: string) => void;
}

function TaskRow({
  task,
  date: _date,
  isOverdue,
  onOpenDetail,
  onActionOpen,
  onMarkResolved,
  onMarkUnresolved,
  onDelete,
  onBlockSender,
}: TaskRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-border px-5 py-4 last:border-b-0",
        task.status === "done" && "opacity-60",
      )}
    >
      <Checkbox
        checked={task.status === "done"}
        onCheckedChange={(checked) =>
          checked === true ? onMarkResolved() : onMarkUnresolved()
        }
        aria-label={task.title}
        className="shrink-0"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onOpenDetail}
        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md -m-1 p-1"
      >
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              "text-sm font-medium text-foreground",
              task.status === "done" && "line-through",
            )}
          >
            {task.title}
          </span>
          {isOverdue && task.snapshotDate && (
            <span className="ml-2 text-xs text-muted-foreground">
              ({formatOverdueLabel(task.snapshotDate)})
            </span>
          )}
        </div>
        {task.priority === "urgent" && task.urgentReason?.trim() ? (
          <span
            className="flex max-w-[200px] shrink-0 items-center gap-1.5 truncate text-xs text-muted-foreground"
            title={task.urgentReason}
          >
            <CentralIcon
              name="IconExclamationTriangle"
              size={14}
              className="shrink-0 text-destructive"
            />
            <span className="truncate">{task.urgentReason}</span>
          </span>
        ) : null}
        <SourceLogo provider={task.sourceProvider} />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Task actions"
            onClick={(e) => e.stopPropagation()}
          >
            <CentralIcon
              name="IconBarsThree"
              size={16}
              className="text-muted-foreground"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {task.sourceProvider === "gmail" && task.sourceRef?.sourceUrl ? (
            <DropdownMenuItem asChild>
              <a
                href={task.sourceRef.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex cursor-pointer items-center gap-2"
              >
                <CentralIcon name="IconEmail1" size={16} />
                Show mail
              </a>
            </DropdownMenuItem>
          ) : null}
          {task.sourceProvider === "gmail" &&
          task.sourceRef?.sender &&
          onBlockSender ? (
            <DropdownMenuItem
              onClick={() => onBlockSender(task.sourceRef!.sender!)}
            >
              <CentralIcon name="IconBlock" size={16} />
              Block sender
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={onMarkResolved}>
            <CentralIcon name="IconCircleCheck" size={16} />
            Mark as resolved
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onActionOpen("date")}>
            <CentralIcon name="IconCalendar1" size={16} />
            Change date
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onActionOpen("name")}>
            <CentralIcon name="IconPencil" size={16} />
            Change name
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <CentralIcon name="IconTrashCan" size={16} />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function formatDisplayDate(date: Date) {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Local date as YYYY-MM-DD (matches calendar day user sees, avoids UTC shift). */
function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Format past date as "Yesterday", "Mon 02 Feb", or "Last month". */
function formatOverdueLabel(snapshotDate: string): string {
  const today = toLocalDateString(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toLocalDateString(yesterday);

  if (snapshotDate === yesterdayStr) return "Yesterday";
  if (snapshotDate === today) return "Today";

  const d = new Date(snapshotDate + "T12:00:00");
  const now = new Date();
  const isLastMonth =
    d.getFullYear() < now.getFullYear() || d.getMonth() < now.getMonth();

  if (isLastMonth) return "Last month";

  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
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

const PROVIDER_LOGO: Record<string, string> = {
  google_calendar: "/app-logos/google_calendar.svg",
  gmail: "/app-logos/gmail.svg",
  notion: "/app-logos/notion.svg",
};

const PROVIDER_TITLE: Record<string, string> = {
  google_calendar: "Google Calendar",
  gmail: "Gmail",
  notion: "Notion",
};

function getProviderTitle(provider?: string): string {
  return (provider && PROVIDER_TITLE[provider]) || provider || "Source";
}

function SourceLogo({ provider }: { provider?: string }) {
  const iconClass = "size-3";
  const logoSrc = provider ? PROVIDER_LOGO[provider] : null;
  const content = logoSrc ? (
    <Image
      src={logoSrc}
      alt=""
      className="size-full object-contain"
      width={18}
      height={18}
    />
  ) : (
    (() => {
      switch (provider) {
        case "linear":
          return (
            <CentralIcon name="IconChecklist" size={18} className={iconClass} />
          );
        default:
          return (
            <CentralIcon name="IconCircle" size={18} className={iconClass} />
          );
      }
    })()
  );
  return (
    <div
      className="flex size-[18px] shrink-0 items-center justify-center overflow-hidden"
      title={provider ?? "Unknown source"}
    >
      {content}
    </div>
  );
}

interface TaskDetailModalProps {
  task: TodoItemWithMeta | null;
  date: string;
  onClose: () => void;
  onMarkResolved: () => void;
  onMarkUnresolved: () => void;
  onActionOpen: (type: "date" | "name") => void;
  onDelete: () => void;
  onBlockSender?: (sender: string) => void;
}

function TaskDetailModal({
  task,
  date: _date,
  onClose,
  onMarkResolved,
  onMarkUnresolved,
  onActionOpen,
  onDelete,
  onBlockSender,
}: TaskDetailModalProps) {
  if (!task) return null;
  const providerTitle = getProviderTitle(task.sourceProvider);
  const openUrl =
    task.sourceRef?.sourceUrl ??
    (task.sourceProvider === "google_calendar"
      ? "https://calendar.google.com"
      : undefined);
  const confidencePercent =
    task.confidence != null ? Math.round(task.confidence * 100) : null;

  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-md">
        <DialogHeader className="shrink-0 gap-3 border-b border-border px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <DialogTitle className="text-left text-xl font-semibold leading-tight tracking-tight">
                {task.title}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Task details: {task.summary}
              </DialogDescription>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <SourceLogo provider={task.sourceProvider} />
                {task.priority === "urgent" && (
                  <Badge variant="destructive" className="font-medium">
                    Urgent
                  </Badge>
                )}
                {task.status === "done" && (
                  <Badge variant="secondary">Done</Badge>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto">
          <div className="space-y-4 px-6 py-5">
            <Card size="sm" className="border-0 bg-muted/30 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm leading-relaxed text-foreground">
                  {task.summary}
                </p>
              </CardContent>
            </Card>

            {task.urgentReason?.trim() ? (
              <Card
                size="sm"
                className="border-destructive/30 bg-destructive/5 shadow-none"
              >
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-destructive">
                    <CentralIcon
                      name="IconExclamationTriangle"
                      size={14}
                      className="shrink-0"
                    />
                    Why urgent
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm leading-relaxed text-foreground">
                    {task.urgentReason}
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {(task.suggestedNextAction?.trim() ||
              task.actionabilityEvidence?.trim()) && (
              <>
                <Separator className="my-1" />
                <div className="space-y-4">
                  {task.suggestedNextAction?.trim() && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Suggested next action
                      </p>
                      <p className="text-sm leading-relaxed text-foreground">
                        {task.suggestedNextAction}
                      </p>
                    </div>
                  )}
                  {task.actionabilityEvidence?.trim() && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Evidence
                      </p>
                      <blockquote className="border-l-2 border-muted-foreground/30 pl-3 text-sm italic leading-relaxed text-muted-foreground">
                        &ldquo;{task.actionabilityEvidence}&rdquo;
                      </blockquote>
                    </div>
                  )}
                </div>
              </>
            )}

            <Separator className="my-1" />
            <div className="flex flex-wrap items-center gap-2">
              {task.sourceProvider && (
                <Badge variant="secondary" className="font-normal">
                  {providerTitle}
                  {task.sourceType
                    ? ` · ${task.sourceType.replace(/_/g, " ")}`
                    : ""}
                </Badge>
              )}
              {confidencePercent != null && (
                <Badge variant="outline" className="font-normal">
                  {confidencePercent}% confidence
                </Badge>
              )}
              {task.tags && task.tags.length > 0 && (
                <>
                  {task.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="font-normal">
                      {tag}
                    </Badge>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 flex-col gap-2 border-t border-border bg-muted/20 px-6 py-4 sm:flex-row sm:flex-wrap">
          {openUrl && (
            <Button asChild className="w-full sm:w-auto">
              <a href={openUrl} target="_blank" rel="noopener noreferrer">
                Open in {providerTitle}
              </a>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="w-full sm:w-auto">
                Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {openUrl && (
                <>
                  <DropdownMenuItem asChild>
                    <a
                      href={openUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex cursor-pointer items-center gap-2"
                    >
                      <CentralIcon name="IconEmail1" size={16} />
                      Open in {providerTitle}
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                onClick={() => {
                  onClose();
                  if (task.status === "done") {
                    onMarkUnresolved();
                  } else {
                    onMarkResolved();
                  }
                }}
              >
                <CentralIcon name="IconCircleCheck" size={16} />
                {task.status === "done" ? "Mark as open" : "Mark as resolved"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  onClose();
                  onActionOpen("date");
                }}
              >
                <CentralIcon name="IconCalendar1" size={16} />
                Change date
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  onClose();
                  onActionOpen("name");
                }}
              >
                <CentralIcon name="IconPencil" size={16} />
                Change name
              </DropdownMenuItem>
              {task.sourceProvider === "gmail" &&
              task.sourceRef?.sender &&
              onBlockSender ? (
                <DropdownMenuItem
                  onClick={() => {
                    onBlockSender(task.sourceRef!.sender!);
                    onClose();
                  }}
                >
                  <CentralIcon name="IconBlock" size={16} />
                  Block sender
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  onClose();
                  onDelete();
                }}
              >
                <CentralIcon name="IconTrashCan" size={16} />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HomeContent({ userName, userId }: HomeContentProps) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [journalValue, setJournalValue] = useState("");
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [integrationTasks, setIntegrationTasks] = useState<
    IntegrationTodoItem[]
  >([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [hasSnapshot, setHasSnapshot] = useState<boolean | null>(null);
  const [generatingTasks, setGeneratingTasks] = useState(false);
  const [overdueItems, setOverdueItems] = useState<TodoItemWithMeta[]>([]);
  const [overdueLoading, setOverdueLoading] = useState(true);
  const [detailModalTask, setDetailModalTask] =
    useState<TodoItemWithMeta | null>(null);
  const [actionDialog, setActionDialog] = useState<null | {
    type: "date" | "name";
    task: TodoItemWithMeta;
    date: string;
  }>(null);
  const [actionPending, setActionPending] = useState(false);
  const [changeDateTo, setChangeDateTo] = useState("");
  const [changeNameTo, setChangeNameTo] = useState("");

  const isToday =
    toLocalDateString(selectedDate) === toLocalDateString(new Date());
  const { calendarVersion, tasksVersion } = useSupabaseRealtime();

  const refetchTasksForSelectedDay = useCallback(() => {
    if (!userId) return;
    const dateStr = toLocalDateString(selectedDate);
    fetch(`/api/integrations/todos?date=${dateStr}`, {
      cache: "no-store",
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload: Partial<IntegrationTodoListResponse> | null) => {
        if (payload && Array.isArray(payload.items)) {
          setIntegrationTasks(payload.items.map(normalizeTodoItem));
          setHasSnapshot(true);
        }
      });
  }, [userId, selectedDate]);

  const refetchOverdue = useCallback(() => {
    if (!userId) return;
    const today = toLocalDateString(new Date());
    fetch(`/api/integrations/todos/overdue?days=31&today=${today}`, {
      cache: "no-store",
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { items?: TodoItemWithMeta[] } | null) => {
        if (data && Array.isArray(data.items)) {
          setOverdueItems(
            data.items.map(normalizeTodoItem) as TodoItemWithMeta[],
          );
        }
      })
      .catch(() => setOverdueItems([]));
  }, [userId]);

  async function patchItem(
    date: string,
    itemId: string,
    action: "update" | "delete" | "move",
    extra?: {
      status?: "open" | "done";
      title?: string;
      toDate?: string;
    },
  ) {
    setActionPending(true);
    try {
      const body: Record<string, unknown> = { date, itemId, action };
      if (action === "update" && extra) {
        if (extra.status) body.status = extra.status;
        if (extra.title !== undefined) body.title = extra.title;
      }
      if (action === "move" && extra?.toDate) body.toDate = extra.toDate;
      const res = await fetch("/api/integrations/todos/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      setActionDialog(null);
      refetchTasksForSelectedDay();
      if (isToday) refetchOverdue();
    } finally {
      setActionPending(false);
    }
  }

  const blockSender = useCallback(async (sender: string) => {
    const email = normalizeSenderToEmail(sender);
    if (!email) return;
    try {
      const getRes = await fetch("/api/settings/todo-email-scope", {
        credentials: "include",
      });
      if (!getRes.ok) return;
      const scope = (await getRes.json()) as {
        sendersBlocked?: string[];
        labelIdsBlocked?: string[];
        labelIdsAccepted?: string[];
        sendersAccepted?: string[];
      };
      const current = scope.sendersBlocked ?? [];
      if (current.map((e) => e.toLowerCase()).includes(email)) return;
      const sendersBlocked = [...current, email];
      const patchRes = await fetch("/api/settings/todo-email-scope", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          labelIdsAccepted: scope.labelIdsAccepted ?? [],
          labelIdsBlocked: scope.labelIdsBlocked ?? [],
          sendersAccepted: scope.sendersAccepted ?? [],
          sendersBlocked,
        }),
      });
      if (!patchRes.ok) return;
    } catch {
      // ignore
    }
  }, []);

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
      queueMicrotask(() => {
        setCalendarEvents([]);
        setCalendarLoading(false);
      });
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

      const { data, error } = await db.selectMany(
        supabase as unknown as Parameters<typeof db.selectMany>[0],
        "activity_atoms",
        { user_id: userId, atom_type: "event" },
        {
          columns: "id, title, occurred_at, duration_minutes, categories",
          rangeFilters: {
            occurred_at: {
              gte: start.toISOString(),
              lt: end.toISOString(),
            },
          },
          order: { column: "occurred_at", ascending: true },
        },
      );

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
  }, [userId, selectedDate, calendarVersion]);

  useEffect(() => {
    if (!userId) {
      queueMicrotask(() => {
        setIntegrationTasks([]);
        setHasSnapshot(null);
        setTasksLoading(false);
      });
      return;
    }

    const controller = new AbortController();
    const dateStr = toLocalDateString(selectedDate);
    const onlyFromCache = !isToday;

    async function fetchTasks() {
      setTasksLoading(true);
      try {
        const url = onlyFromCache
          ? `/api/integrations/todos?date=${dateStr}&onlyFromCache=true`
          : `/api/integrations/todos?date=${dateStr}`;
        const response = await fetch(url, {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) {
          setIntegrationTasks([]);
          setHasSnapshot(null);
          return;
        }
        const payload =
          (await response.json()) as Partial<IntegrationTodoListResponse>;
        setIntegrationTasks(
          Array.isArray(payload.items)
            ? payload.items.map(normalizeTodoItem)
            : [],
        );
        setHasSnapshot(payload.hasSnapshot ?? true);
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") {
          setIntegrationTasks([]);
          setHasSnapshot(null);
        }
      } finally {
        setTasksLoading(false);
      }
    }

    fetchTasks();
    return () => controller.abort();
  }, [userId, selectedDate, isToday, tasksVersion]);

  useEffect(() => {
    if (actionDialog) {
      setChangeDateTo(toLocalDateString(new Date()));
      setChangeNameTo(actionDialog.task.title);
    }
  }, [actionDialog]);

  useEffect(() => {
    if (!userId || !isToday) {
      setOverdueItems([]);
      setOverdueLoading(false);
      return;
    }
    const controller = new AbortController();
    setOverdueLoading(true);
    const today = toLocalDateString(new Date());
    fetch(`/api/integrations/todos/overdue?days=31&today=${today}`, {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { items?: TodoItemWithMeta[] } | null) => {
        if (data && Array.isArray(data.items)) {
          setOverdueItems(
            data.items.map(normalizeTodoItem) as TodoItemWithMeta[],
          );
        } else {
          setOverdueItems([]);
        }
      })
      .catch(() => setOverdueItems([]))
      .finally(() => setOverdueLoading(false));
    return () => controller.abort();
  }, [userId, isToday, tasksVersion]);

  async function generateTasksForSelectedDay() {
    if (!userId) return;
    const dateStr = toLocalDateString(selectedDate);
    setGeneratingTasks(true);
    try {
      const response = await fetch(`/api/integrations/todos?date=${dateStr}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) return;
      const payload =
        (await response.json()) as Partial<IntegrationTodoListResponse>;
      setIntegrationTasks(
        Array.isArray(payload.items)
          ? payload.items.map(normalizeTodoItem)
          : [],
      );
      setHasSnapshot(true);
    } finally {
      setGeneratingTasks(false);
    }
  }

  const isLoadingTasks = tasksLoading || (isToday && overdueLoading);
  const hasTasksData =
    integrationTasks.length > 0 ||
    (isToday && overdueItems.length > 0) ||
    hasSnapshot !== null;
  const showTasksSkeleton = isLoadingTasks && !hasTasksData;

  return (
    <div
      className="relative flex min-h-screen flex-col items-center bg-background p-4"
      style={{
        backgroundImage: "url(/bg.svg)",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "top left",
        backgroundSize: "auto 50vh",
      }}
    >
      <div className="flex w-full max-w-5xl flex-1 flex-col items-stretch gap-14 px-4 py-8 md:px-8 md:py-10 lg:px-32">
        {/* Header: greeting + date navigation */}
        <header className="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl text-foreground">
            {getGreeting()}, {displayName}
          </h1>

          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-foreground">
              {formatDisplayDate(selectedDate)}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedDate(new Date())}
              aria-label="Go to today"
              className="ml-1"
            >
              Today
            </Button>
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="icon"
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

              <Button
                variant="ghost"
                size="icon"
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
          </div>
        </header>

        {/* Tasks section */}
        <section className="flex w-full flex-col gap-4">
          <h2 className="text-xl font-serif">Tasks</h2>

          <div
            className={cn(
              "overflow-hidden rounded-2xl border border-border bg-card w-full",
              showTasksSkeleton && "min-h-[280px]",
            )}
          >
            {showTasksSkeleton ? (
              <TasksSectionSkeleton />
            ) : !isToday && hasSnapshot === false ? (
              <div className="flex flex-col gap-4 px-5 py-6">
                <p className="text-sm text-muted-foreground">
                  No tasks generated yet for this day.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-fit"
                  onClick={generateTasksForSelectedDay}
                  disabled={generatingTasks}
                >
                  {generatingTasks
                    ? "Generating…"
                    : "Generate tasks for this day"}
                </Button>
              </div>
            ) : (
              (() => {
                const selectedStr = toLocalDateString(selectedDate);
                const mergedTasks: TodoItemWithMeta[] = isToday
                  ? [
                      ...overdueItems,
                      ...integrationTasks.map((t) => ({
                        ...t,
                        snapshotDate: selectedStr,
                      })),
                    ]
                  : integrationTasks.map((t) => ({
                      ...t,
                      snapshotDate: selectedStr,
                    }));
                const sorted = isToday
                  ? sortMergedTasks(mergedTasks, selectedStr)
                  : sortTasksByPriority(mergedTasks);

                if (sorted.length === 0) {
                  return (
                    <p className="px-5 py-4 text-sm text-muted-foreground">
                      No tasks for this day
                    </p>
                  );
                }

                return (
                  <>
                    {sorted.map((task) => {
                      const taskDate = task.snapshotDate ?? selectedStr;
                      const isOverdue =
                        task.snapshotDate != null &&
                        task.snapshotDate !== selectedStr;
                      return (
                        <TaskRow
                          key={task.id}
                          task={task}
                          date={taskDate}
                          isOverdue={isOverdue}
                          onOpenDetail={() => setDetailModalTask(task)}
                          onActionOpen={(type) =>
                            setActionDialog({
                              type,
                              task,
                              date: taskDate,
                            })
                          }
                          onMarkResolved={() =>
                            patchItem(taskDate, task.id, "update", {
                              status: "done",
                            })
                          }
                          onMarkUnresolved={() =>
                            patchItem(taskDate, task.id, "update", {
                              status: "open",
                            })
                          }
                          onDelete={() =>
                            patchItem(taskDate, task.id, "delete")
                          }
                          onBlockSender={blockSender}
                        />
                      );
                    })}
                  </>
                );
              })()
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

        {/* Task detail modal */}
        <TaskDetailModal
          task={detailModalTask}
          date={
            detailModalTask
              ? (detailModalTask.snapshotDate ??
                toLocalDateString(selectedDate))
              : ""
          }
          onClose={() => setDetailModalTask(null)}
          onMarkResolved={() => {
            if (!detailModalTask) return;
            const d =
              detailModalTask.snapshotDate ?? toLocalDateString(selectedDate);
            setDetailModalTask(null);
            patchItem(d, detailModalTask.id, "update", { status: "done" });
          }}
          onMarkUnresolved={() => {
            if (!detailModalTask) return;
            const d =
              detailModalTask.snapshotDate ?? toLocalDateString(selectedDate);
            setDetailModalTask(null);
            patchItem(d, detailModalTask.id, "update", { status: "open" });
          }}
          onActionOpen={(type) => {
            if (!detailModalTask) return;
            const d =
              detailModalTask.snapshotDate ?? toLocalDateString(selectedDate);
            setDetailModalTask(null);
            setActionDialog({
              type,
              task: detailModalTask,
              date: d,
            });
          }}
          onDelete={() => {
            if (!detailModalTask) return;
            const d =
              detailModalTask.snapshotDate ?? toLocalDateString(selectedDate);
            setDetailModalTask(null);
            patchItem(d, detailModalTask.id, "delete");
          }}
          onBlockSender={blockSender}
        />

        {/* Task action dialogs */}
        <Dialog
          open={!!actionDialog}
          onOpenChange={(open) => !open && setActionDialog(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {actionDialog?.type === "date" ? "Change date" : "Change name"}
              </DialogTitle>
            </DialogHeader>
            {actionDialog?.type === "date" && (
              <div className="flex flex-col gap-3">
                <Input
                  type="date"
                  value={changeDateTo}
                  onChange={(e) => setChangeDateTo(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setChangeDateTo(toLocalDateString(new Date()))
                    }
                  >
                    Today
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const t = new Date();
                      t.setDate(t.getDate() + 1);
                      setChangeDateTo(toLocalDateString(t));
                    }}
                  >
                    Tomorrow
                  </Button>
                </div>
              </div>
            )}
            {actionDialog?.type === "name" && (
              <Input
                value={changeNameTo}
                onChange={(e) => setChangeNameTo(e.target.value)}
                placeholder="Task name"
              />
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setActionDialog(null)}>
                Cancel
              </Button>
              <Button
                disabled={actionPending}
                onClick={() => {
                  if (!actionDialog) return;
                  if (actionDialog.type === "date") {
                    patchItem(actionDialog.date, actionDialog.task.id, "move", {
                      toDate: changeDateTo,
                    });
                  } else {
                    patchItem(
                      actionDialog.date,
                      actionDialog.task.id,
                      "update",
                      {
                        title: changeNameTo.trim() || actionDialog.task.title,
                      },
                    );
                  }
                }}
              >
                {actionDialog?.type === "date" ? "Move" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Calendar section */}
        <section className="flex w-full max-w-[720px] flex-col gap-4">
          <h2 className="text-xl font-serif">Calendar</h2>
          <div
            className={cn(
              "flex flex-col gap-1",
              calendarLoading && "min-h-[180px]",
            )}
          >
            {calendarLoading ? (
              <CalendarSectionSkeleton />
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
        <section className="flex w-full flex-col gap-4">
          <h2 className="text-xl font-serif">Journal</h2>
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
          <div className="overflow-hidden rounded-2xl border border-border bg-card w-full">
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
    </div>
  );
}
