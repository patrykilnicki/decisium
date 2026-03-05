"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

const TOGGLE_KEYS = [
  "fromCalendar",
  "fromEmails",
  "replyTasks",
  "fromNewsletters",
  "prepForMeetings",
  "fromAutomatedBots",
] as const;

type ToggleKey = (typeof TOGGLE_KEYS)[number];

interface TodoPromptToggles {
  fromCalendar?: boolean;
  fromEmails?: boolean;
  replyTasks?: boolean;
  fromNewsletters?: boolean;
  prepForMeetings?: boolean;
  fromAutomatedBots?: boolean;
}

interface _TodoPromptSettings {
  toggles?: TodoPromptToggles;
  customInstructions?: string | null;
}

const DEFAULT_TOGGLES: Record<ToggleKey, boolean> = {
  fromCalendar: true,
  fromEmails: true,
  replyTasks: true,
  fromNewsletters: false,
  prepForMeetings: true,
  fromAutomatedBots: false,
};

const TOGGLE_LABELS: Record<ToggleKey, string> = {
  fromCalendar: "Uwzględniaj kalendarz",
  fromEmails: "Uwzględniaj maile",
  replyTasks: "Zadania typu «odpowiedz na e-mail»",
  fromNewsletters: "Zadania z newsletterów / marketingu",
  prepForMeetings: "Zadania «przygotowanie do spotkania» z kalendarza",
  fromAutomatedBots: "Zadania z wiadomości od botów/automatów",
};

const CUSTOM_INSTRUCTIONS_MAX = 1000;

export function TodoPromptSettingsSection() {
  const [toggles, setToggles] = useState<TodoPromptToggles>({});
  const [customInstructions, setCustomInstructions] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/todo-prompt-settings");
      if (!res.ok) return;
      const data = await res.json();
      setToggles((data.toggles as TodoPromptToggles) ?? {});
      setCustomInstructions(
        typeof data.customInstructions === "string"
          ? data.customInstructions
          : "",
      );
    } catch {
      setToggles({});
      setCustomInstructions("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (notification) {
      const t = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(t);
    }
  }, [notification]);

  const toggle = useCallback((key: ToggleKey, checked: boolean) => {
    setToggles((prev) => ({ ...prev, [key]: checked }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const body = {
        toggles: { ...DEFAULT_TOGGLES, ...toggles },
        customInstructions: customInstructions.trim() || null,
      };
      const res = await fetch("/api/settings/todo-prompt-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to save");
      }
      setNotification({ type: "success", message: "Zapisano" });
    } catch (e) {
      setNotification({
        type: "error",
        message: e instanceof Error ? e.message : "Nie udało się zapisać",
      });
    } finally {
      setSaving(false);
    }
  }, [toggles, customInstructions]);

  const effectiveToggles = { ...DEFAULT_TOGGLES, ...toggles };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Generowanie zadań to-do</h2>
        <p className="text-sm text-muted-foreground">
          Wybierz, z jakich źródeł i typów mają powstawać zadania. Możesz też
          dodać własne instrukcje dla modelu.
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

      {loading ? (
        <p className="text-sm text-muted-foreground">Ładowanie…</p>
      ) : (
        <>
          <div className="space-y-3">
            <Label className="text-base font-medium">Źródła i typy zadań</Label>
            <ul className="space-y-2 rounded-md border p-3">
              {TOGGLE_KEYS.map((key) => (
                <li key={key} className="flex items-center gap-2">
                  <Checkbox
                    id={`prompt-${key}`}
                    checked={effectiveToggles[key]}
                    onCheckedChange={(c) => toggle(key, c === true)}
                  />
                  <label
                    htmlFor={`prompt-${key}`}
                    className="text-sm cursor-pointer flex-1"
                  >
                    {TOGGLE_LABELS[key]}
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="custom-instructions"
              className="text-base font-medium"
            >
              Własne instrukcje
            </Label>
            <Textarea
              id="custom-instructions"
              placeholder="Np. Twórz tylko zadania z spotkań z klientem. Pomijaj małe spotkania wewnętrzne."
              value={customInstructions}
              onChange={(e) =>
                setCustomInstructions(
                  e.target.value.slice(0, CUSTOM_INSTRUCTIONS_MAX),
                )
              }
              maxLength={CUSTOM_INSTRUCTIONS_MAX}
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              {customInstructions.length}/{CUSTOM_INSTRUCTIONS_MAX} znaków
            </p>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </>
      )}
    </div>
  );
}
