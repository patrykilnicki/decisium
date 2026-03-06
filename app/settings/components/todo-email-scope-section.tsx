"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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

/** Gmail system label IDs → user-friendly display names (for UI only). */
const SYSTEM_LABEL_DISPLAY_NAMES: Record<string, string> = {
  SPAM: "Spam",
  CATEGORY_FORUMS: "Forums",
  CATEGORY_UPDATES: "Updates",
  CATEGORY_PERSONAL: "Personal",
  CATEGORY_PROMOTIONS: "Promotions",
  CATEGORY_SOCIAL: "Social",
};

/** System label IDs that user can add to block/keep lists (even if not in API response). */
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

/** Stable color index for a label id (for tag background). */
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
          message: err.error ?? "Nie udało się pobrać etykiet",
        });
        return;
      }
      const data = await res.json();
      setLabels(data.labels ?? []);
    } catch {
      setNotification({
        type: "error",
        message: "Nie udało się pobrać etykiet",
      });
    } finally {
      setLabelsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  useEffect(() => {
    if (gmailConnected) fetchScope();
    else setScopeLoading(false);
  }, [gmailConnected, fetchScope]);

  /** Auto-fetch labels when Gmail is connected and scope is loaded. */
  useEffect(() => {
    if (gmailConnected && !scopeLoading) fetchLabels();
  }, [gmailConnected, scopeLoading, fetchLabels]);

  useEffect(() => {
    if (notification) {
      const t = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(t);
    }
  }, [notification]);

  /** All labels user can add: system (with friendly names) + custom from Gmail. */
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

  const addLabelAccepted = useCallback((id: string) => {
    setScope((prev) => {
      const list = prev.labelIdsAccepted ?? [];
      if (list.includes(id)) return prev;
      return { ...prev, labelIdsAccepted: [...list, id] };
    });
  }, []);

  const removeLabelAccepted = useCallback((id: string) => {
    setScope((prev) => ({
      ...prev,
      labelIdsAccepted: (prev.labelIdsAccepted ?? []).filter((x) => x !== id),
    }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const body = {
        labelIdsAccepted: scope.labelIdsAccepted ?? [],
        labelIdsBlocked: scope.labelIdsBlocked ?? [],
        sendersAccepted: [], // zawsze puste: domyślnie wszyscy nadawcy są uwzględniani, user tylko blokuje
        sendersBlocked: scope.sendersBlocked ?? [],
      };
      const res = await fetch("/api/settings/todo-email-scope", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Zapis nie powiódł się");
      }
      setNotification({ type: "success", message: "Zapisano ustawienia" });
    } catch (e) {
      setNotification({
        type: "error",
        message: e instanceof Error ? e.message : "Zapis nie powiódł się",
      });
    } finally {
      setSaving(false);
    }
  }, [scope]);

  const blockedIds = scope.labelIdsBlocked ?? [];
  const acceptedIds = scope.labelIdsAccepted ?? [];
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
          "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-medium",
          labelColorClass(labelId),
        )}
      >
        <CentralIcon name="IconBarsThree" size={14} className="opacity-60" />
        <span>{displayName}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
              aria-label="Opcje"
            >
              <CentralIcon name="IconDotGrid1x3Vertical" size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={onRemove}>
              Usuń
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    );
  }

  function SectionBlock({
    title,
    description,
    labelIds,
    onAdd,
    onRemove,
    addButtonLabel,
  }: {
    title: string;
    description: string;
    labelIds: string[];
    onAdd: (id: string) => void;
    onRemove: (id: string) => void;
    addButtonLabel: string;
  }) {
    const availableToAdd = allSelectableLabels.filter(
      (l) => !labelIds.includes(l.id),
    );
    return (
      <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-medium">{title}</h3>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0 rounded-full"
                disabled={labelsLoading || availableToAdd.length === 0}
                aria-label={addButtonLabel}
              >
                <CentralIcon name="IconPlusSmall" size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-h-64 overflow-y-auto"
            >
              {availableToAdd.map((l) => (
                <DropdownMenuItem key={l.id} onSelect={() => onAdd(l.id)}>
                  {getLabelDisplayName(l.id, l.name)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <ul className="flex flex-wrap gap-2">
          {labelIds.map((id) => (
            <li key={id}>
              <LabelTag labelId={id} onRemove={() => onRemove(id)} />
            </li>
          ))}
          {labelIds.length === 0 && (
            <li className="text-sm text-muted-foreground">
              Brak etykiet — wszystkie maile są uwzględniane
            </li>
          )}
        </ul>
      </div>
    );
  }

  if (integrationsLoading || !gmailConnected) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Zakres maili do zadań to-do</h2>
        <p className="text-sm text-muted-foreground">
          Domyślnie uwzględniane są wszystkie e-maile. Możesz dodać etykiety,
          które mają być pomijane (przeniesione poza skrzynkę) lub wybrać tylko
          te, które mają być uwzględniane (zostaw w skrzynce).
        </p>
      </div>

      {notification && (
        <div
          className={cn(
            "rounded-lg p-3 text-sm",
            notification.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200 dark:bg-green-950/50 dark:text-green-200 dark:border-green-800"
              : "bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/50 dark:text-red-200 dark:border-red-800",
          )}
        >
          {notification.message}
        </div>
      )}

      {scopeLoading ? (
        <p className="text-sm text-muted-foreground">Ładowanie…</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Label className="text-base font-medium">Etykiety Gmail</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={fetchLabels}
              disabled={labelsLoading}
            >
              <CentralIcon name="IconRotate" size={16} />
              {labelsLoading ? "Ładowanie…" : "Odśwież listę"}
            </Button>
          </div>

          <div className="space-y-4">
            <SectionBlock
              title="Przenieś poza skrzynkę"
              description="Maile z tymi etykietami nie będą generować zadań to-do."
              labelIds={blockedIds}
              onAdd={addLabelBlocked}
              onRemove={removeLabelBlocked}
              addButtonLabel="Dodaj etykietę do wykluczenia"
            />
            <SectionBlock
              title="Zostaw w skrzynce"
              description="Opcjonalnie: tylko maile z tymi etykietami będą uwzględniane. Puste = wszystkie (poza wykluczonymi)."
              labelIds={acceptedIds}
              onAdd={addLabelAccepted}
              onRemove={removeLabelAccepted}
              addButtonLabel="Dodaj etykietę do uwzględnienia"
            />
          </div>

          {/* Senders: tylko blokowani (domyślnie wszyscy są uwzględniani) */}
          <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
            <div>
              <Label className="text-base font-medium">
                Zablokowani nadawcy
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Maile od tych adresów nie będą generować zadań to-do. Jeden
                adres na linię.
              </p>
            </div>
            <Textarea
              placeholder="np. newsletter@example.com"
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
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </>
      )}
    </div>
  );
}
