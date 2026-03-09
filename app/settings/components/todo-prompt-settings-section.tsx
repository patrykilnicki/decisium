"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldTitle,
} from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { TodoPromptSettingsSectionSkeleton } from "./todo-prompt-settings-section-skeleton";

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

const TOGGLE_META: Record<ToggleKey, { label: string; description: string }> = {
  fromCalendar: {
    label: "Calendar events",
    description: "Generate tasks from upcoming calendar events",
  },
  fromEmails: {
    label: "Emails",
    description: "Extract action items from your inbox",
  },
  replyTasks: {
    label: "Reply-to-email tasks",
    description: "Create tasks to reply to emails that need a response",
  },
  fromNewsletters: {
    label: "Newsletters & marketing",
    description: "Include tasks from newsletters and promotional emails",
  },
  prepForMeetings: {
    label: "Meeting prep tasks",
    description: "Create preparation tasks before meetings",
  },
  fromAutomatedBots: {
    label: "Bot & automation messages",
    description: "Include tasks from automated or bot-generated messages",
  },
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
      setNotification({ type: "success", message: "Task settings saved" });
    } catch (e) {
      setNotification({
        type: "error",
        message: e instanceof Error ? e.message : "Failed to save",
      });
    } finally {
      setSaving(false);
    }
  }, [toggles, customInstructions]);

  const effectiveToggles = { ...DEFAULT_TOGGLES, ...toggles };

  if (loading) return <TodoPromptSettingsSectionSkeleton />;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">Sources & task types</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Choose which sources and types should create tasks.
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

      <div className="space-y-3">
        {TOGGLE_KEYS.map((key) => (
          <div
            key={key}
            className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-card/50 px-4 py-3"
          >
            <div className="min-w-0">
              <Label
                htmlFor={`prompt-${key}`}
                className="text-sm font-medium cursor-pointer"
              >
                {TOGGLE_META[key].label}
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                {TOGGLE_META[key].description}
              </p>
            </div>
            <Switch
              id={`prompt-${key}`}
              checked={effectiveToggles[key]}
              onCheckedChange={(c) => toggle(key, c === true)}
            />
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border/60 bg-card/50 p-4 space-y-3">
        <Field className="gap-1.5">
          <FieldTitle className="text-[13px] font-medium tracking-[-0.13px] text-foreground">
            Custom instructions
          </FieldTitle>
          <FieldDescription className="text-muted-foreground text-sm">
            Additional guidance for the model when generating tasks.
          </FieldDescription>
          <FieldContent>
            <Textarea
              id="custom-instructions"
              placeholder="E.g. Only create tasks from client meetings. Skip small internal meetings."
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
            <p className="text-xs text-muted-foreground text-right">
              {customInstructions.length}/{CUSTOM_INSTRUCTIONS_MAX}
            </p>
          </FieldContent>
        </Field>
      </div>

      <Button
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg w-fit"
      >
        {saving ? "Saving…" : "Save task settings"}
      </Button>
    </div>
  );
}
