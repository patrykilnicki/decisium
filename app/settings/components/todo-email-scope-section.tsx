"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldTitle,
} from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CentralIcon } from "@/components/ui/central-icon";
import { TodoEmailScopeSectionSkeleton } from "./todo-email-scope-section-skeleton";

interface GmailLabel {
  id: string;
  name: string;
}

interface TodoEmailScope {
  labelIdsAccepted?: string[];
  labelIdsBlocked?: string[];
  sendersAccepted?: string[];
  sendersBlocked?: string[];
}

const SYSTEM_LABEL_DISPLAY_NAMES: Record<string, string> = {
  SPAM: "Spam",
  CATEGORY_FORUMS: "Forums",
  CATEGORY_UPDATES: "Updates",
  CATEGORY_PERSONAL: "Personal",
  CATEGORY_PROMOTIONS: "Promotions",
  CATEGORY_SOCIAL: "Social",
};

const SYSTEM_LABEL_IDS = [
  "SPAM",
  "CATEGORY_FORUMS",
  "CATEGORY_UPDATES",
  "CATEGORY_PERSONAL",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
];

function getLabelDisplayName(id: string, apiName: string): string {
  return SYSTEM_LABEL_DISPLAY_NAMES[id] ?? apiName;
}

const LABEL_COLORS = [
  "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-800",
  "bg-pink-100 text-pink-800 border-pink-200 dark:bg-pink-950/60 dark:text-pink-200 dark:border-pink-800",
  "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800",
  "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800",
  "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950/60 dark:text-violet-200 dark:border-violet-800",
  "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800",
];

function labelColorClass(labelId: string): string {
  let hash = 0;
  for (let i = 0; i < labelId.length; i++)
    hash = (hash << 1) ^ labelId.charCodeAt(i);
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length];
}

function parseSendersText(text: string): string[] {
  return text
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sendersToText(senders: string[] | undefined): string {
  return (senders ?? []).join("\n");
}

export function TodoEmailScopeSection() {
  const [gmailConnected, setGmailConnected] = useState(false);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [scope, setScope] = useState<TodoEmailScope>({});
  const [scopeLoading, setScopeLoading] = useState(true);
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [labelsLoading, setLabelsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations");
      if (!res.ok) return;
      const data = await res.json();
      const gmail = (
        data.integrations as { provider: string; status: string }[]
      ).find((i: { provider: string }) => i.provider === "gmail");
      setGmailConnected(gmail?.status === "active");
    } catch {
      setGmailConnected(false);
    } finally {
      setIntegrationsLoading(false);
    }
  }, []);

  const fetchScope = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/todo-email-scope");
      if (!res.ok) return;
      const data = await res.json();
      setScope({
        labelIdsAccepted: data.labelIdsAccepted ?? [],
        labelIdsBlocked: data.labelIdsBlocked ?? [],
        sendersAccepted: data.sendersAccepted ?? [],
        sendersBlocked: data.sendersBlocked ?? [],
      });
    } catch {
      setScope({});
    } finally {
      setScopeLoading(false);
    }
  }, []);

  const fetchLabels = useCallback(async () => {
    setLabelsLoading(true);
    try {
      const res = await fetch("/api/integrations/gmail/labels");
      if (!res.ok) {
        const err = await res.json();
        setNotification({
          type: "error",
          message: err.error ?? "Failed to fetch labels",
        });
        return;
      }
      const data = await res.json();
      setLabels(data.labels ?? []);
    } catch {
      setNotification({
        type: "error",
        message: "Failed to fetch labels",
      });
    } finally {
      setLabelsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  useEffect(() => {
    if (!gmailConnected) {
      setScopeLoading(false);
      setLabelsLoading(false);
      return;
    }
    setScopeLoading(true);
    setLabelsLoading(true);
    Promise.all([fetchScope(), fetchLabels()]);
  }, [gmailConnected, fetchScope, fetchLabels]);

  useEffect(() => {
    if (notification) {
      const t = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(t);
    }
  }, [notification]);

  const allSelectableLabels = useMemo((): GmailLabel[] => {
    const byId = new Map<string, GmailLabel>();
    for (const id of SYSTEM_LABEL_IDS) {
      byId.set(id, {
        id,
        name: SYSTEM_LABEL_DISPLAY_NAMES[id] ?? id,
      });
    }
    for (const l of labels) {
      if (!byId.has(l.id)) byId.set(l.id, { id: l.id, name: l.name });
    }
    return Array.from(byId.values()).sort((a, b) =>
      (SYSTEM_LABEL_DISPLAY_NAMES[a.id] ?? a.name).localeCompare(
        SYSTEM_LABEL_DISPLAY_NAMES[b.id] ?? b.name,
      ),
    );
  }, [labels]);

  const addLabelBlocked = useCallback((id: string) => {
    setScope((prev) => {
      const list = prev.labelIdsBlocked ?? [];
      if (list.includes(id)) return prev;
      return { ...prev, labelIdsBlocked: [...list, id] };
    });
  }, []);

  const removeLabelBlocked = useCallback((id: string) => {
    setScope((prev) => ({
      ...prev,
      labelIdsBlocked: (prev.labelIdsBlocked ?? []).filter((x) => x !== id),
    }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const body = {
        labelIdsAccepted: [],
        labelIdsBlocked: scope.labelIdsBlocked ?? [],
        sendersAccepted: [],
        sendersBlocked: scope.sendersBlocked ?? [],
      };
      const res = await fetch("/api/settings/todo-email-scope", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Save failed");
      }
      setNotification({ type: "success", message: "Email scope saved" });
    } catch (e) {
      setNotification({
        type: "error",
        message: e instanceof Error ? e.message : "Save failed",
      });
    } finally {
      setSaving(false);
    }
  }, [scope]);

  const blockedIds = scope.labelIdsBlocked ?? [];
  const labelById = useMemo(() => {
    const m = new Map<string, GmailLabel>();
    for (const l of allSelectableLabels) m.set(l.id, l);
    return m;
  }, [allSelectableLabels]);

  function LabelTag({
    labelId,
    onRemove,
  }: {
    labelId: string;
    onRemove: () => void;
  }) {
    const item = labelById.get(labelId);
    const displayName = item
      ? getLabelDisplayName(item.id, item.name)
      : labelId;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
          labelColorClass(labelId),
        )}
      >
        <span>{displayName}</span>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-full size-4 inline-flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 -mr-0.5 text-[10px] leading-none"
          aria-label={`Remove ${displayName}`}
        >
          &times;
        </button>
      </span>
    );
  }

  const sectionLoading =
    integrationsLoading || (gmailConnected && (scopeLoading || labelsLoading));

  if (!gmailConnected && !integrationsLoading) return null;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">Email scope</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          By default all emails are included. Exclude labels or senders that
          should not generate to-do tasks.
        </p>
      </div>

      {notification && (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            notification.type === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200",
          )}
        >
          {notification.message}
        </div>
      )}

      {sectionLoading ? (
        <TodoEmailScopeSectionSkeleton />
      ) : (
        <>
          <div className="rounded-lg border border-border/60 bg-card/50 p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <Label className="text-sm font-medium">Excluded labels</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Emails with these labels will be ignored.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={fetchLabels}
                  disabled={labelsLoading}
                  className="h-8 text-xs gap-1.5"
                >
                  <CentralIcon name="IconRotate" size={14} />
                  {labelsLoading ? "Loading…" : "Refresh"}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs gap-1.5"
                      disabled={
                        labelsLoading ||
                        allSelectableLabels.filter(
                          (l) => !blockedIds.includes(l.id),
                        ).length === 0
                      }
                    >
                      <CentralIcon name="IconPlusSmall" size={14} />
                      Add label
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="max-h-64 overflow-y-auto"
                  >
                    {allSelectableLabels
                      .filter((l) => !blockedIds.includes(l.id))
                      .map((l) => (
                        <DropdownMenuItem
                          key={l.id}
                          onSelect={() => addLabelBlocked(l.id)}
                        >
                          {getLabelDisplayName(l.id, l.name)}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {blockedIds.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {blockedIds.map((id) => (
                  <LabelTag
                    key={id}
                    labelId={id}
                    onRemove={() => removeLabelBlocked(id)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-2 text-center rounded-md border border-dashed border-border/60">
                No labels excluded — all emails are in scope
              </p>
            )}
          </div>

          <div className="rounded-lg border border-border/60 bg-card/50 p-4 space-y-3">
            <Field className="gap-1.5">
              <FieldTitle className="text-[13px] font-medium tracking-[-0.13px] text-foreground">
                Blocked senders
              </FieldTitle>
              <FieldDescription className="text-muted-foreground text-sm">
                Emails from these addresses will not generate tasks. One address
                per line.
              </FieldDescription>
              <FieldContent>
                <Textarea
                  placeholder="e.g. newsletter@example.com"
                  value={sendersToText(scope.sendersBlocked)}
                  onChange={(e) =>
                    setScope((prev) => ({
                      ...prev,
                      sendersBlocked: parseSendersText(e.target.value),
                    }))
                  }
                  rows={3}
                  className="resize-none font-mono text-sm"
                />
              </FieldContent>
            </Field>
          </div>

          <Button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg w-fit"
          >
            {saving ? "Saving…" : "Save email scope"}
          </Button>
        </>
      )}
    </div>
  );
}
