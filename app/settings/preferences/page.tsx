"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldTitle,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { COMMON_TIMEZONES, getTimeZoneLabel } from "@/lib/timezones";
import { useUserPreferences } from "@/contexts/user-preferences-context";

const DEFAULT_THEME = "light" as const;

function getDetectedTimezone(): string {
  try {
    if (
      typeof Intl !== "undefined" &&
      Intl.DateTimeFormat?.().resolvedOptions?.().timeZone
    ) {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  } catch {
    // ignore
  }
  return "UTC";
}

export default function SettingsPreferencesPage() {
  const { setTheme: setNextTheme } = useTheme();
  const { preferences, refetch, hasFetched } = useUserPreferences();
  const [timezone, setTimezone] = useState<string>("UTC");
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (hasFetched) {
      setTimezone(preferences.timezone ?? getDetectedTimezone());
    }
  }, [hasFetched, preferences.timezone]);

  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(t);
  }, [notification]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timezone: timezone || null,
          theme: DEFAULT_THEME,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to save");
      }
      await refetch();
      setNextTheme(DEFAULT_THEME);
      setNotification({ type: "success", message: "Preferences saved" });
    } catch (e) {
      setNotification({
        type: "error",
        message: e instanceof Error ? e.message : "Failed to save",
      });
    } finally {
      setSaving(false);
    }
  }

  if (!hasFetched) {
    return (
      <div className="space-y-8">
        <h2 className="text-2xl font-semibold">Preferences</h2>
        <div className="flex flex-col gap-8">
          <div className="space-y-3">
            <div className="h-4 w-24 bg-muted rounded animate-pulse" />
            <div className="h-10 w-full max-w-xs bg-muted rounded-lg animate-pulse" />
          </div>
          <div className="h-9 w-20 bg-muted rounded-md animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-semibold tracking-tight">Preferences</h2>

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

      <div className="flex flex-col gap-8 max-w-xl">
        <Field className="gap-1.5">
          <FieldTitle className="text-[13px] font-medium tracking-[-0.13px] text-foreground">
            Timezone
          </FieldTitle>
          <FieldDescription className="text-muted-foreground text-sm">
            Used for dates and times across the app.
          </FieldDescription>
          <FieldContent>
            <Select value={timezone || "UTC"} onValueChange={setTimezone}>
              <SelectTrigger
                className="h-10 w-full rounded-lg min-w-[200px]"
                size="default"
              >
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                {[
                  ...(timezone &&
                  !COMMON_TIMEZONES.includes(
                    timezone as (typeof COMMON_TIMEZONES)[number],
                  )
                    ? [timezone]
                    : []),
                  ...COMMON_TIMEZONES,
                ].map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {getTimeZoneLabel(tz)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldContent>
        </Field>

        <Button
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-lg w-fit"
        >
          {saving ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </div>
  );
}
