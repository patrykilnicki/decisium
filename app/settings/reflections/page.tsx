"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;
type Frequency = (typeof FREQUENCIES)[number];

interface ReflectionSchedule {
  enabled: boolean;
  time: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  month?: number;
}

interface ReflectionSettingsState {
  daily: ReflectionSchedule;
  weekly: ReflectionSchedule;
  monthly: ReflectionSchedule;
  quarterly: ReflectionSchedule;
  yearly: ReflectionSchedule;
}

const DEFAULT_SETTINGS: ReflectionSettingsState = {
  daily: { enabled: false, time: "09:00" },
  weekly: { enabled: false, time: "09:00", dayOfWeek: 1 },
  monthly: { enabled: false, time: "09:00", dayOfMonth: 1 },
  quarterly: { enabled: false, time: "09:00", dayOfMonth: 1 },
  yearly: { enabled: false, time: "09:00", month: 1, dayOfMonth: 1 },
};

const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

const WEEKDAY_OPTIONS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

const MONTH_OPTIONS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

function dayOfMonthOptions(max: number) {
  return Array.from({ length: max }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
  }));
}

export default function SettingsReflectionsPage() {
  const [settings, setSettings] =
    useState<ReflectionSettingsState>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/reflections");
      if (!res.ok) return;
      const data = await res.json();
      setSettings({
        daily: { ...DEFAULT_SETTINGS.daily, ...data.daily },
        weekly: { ...DEFAULT_SETTINGS.weekly, ...data.weekly },
        monthly: { ...DEFAULT_SETTINGS.monthly, ...data.monthly },
        quarterly: { ...DEFAULT_SETTINGS.quarterly, ...data.quarterly },
        yearly: { ...DEFAULT_SETTINGS.yearly, ...data.yearly },
      });
    } catch {
      setSettings(DEFAULT_SETTINGS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(t);
  }, [notification]);

  function setEnabled(freq: Frequency, enabled: boolean) {
    setSettings((prev) => ({
      ...prev,
      [freq]: { ...prev[freq], enabled },
    }));
  }

  function setTime(freq: Frequency, time: string) {
    setSettings((prev) => ({
      ...prev,
      [freq]: { ...prev[freq], time },
    }));
  }

  function setDayOfWeek(dayOfWeek: number) {
    setSettings((prev) => ({
      ...prev,
      weekly: { ...prev.weekly, dayOfWeek },
    }));
  }

  function setDayOfMonth(
    freq: "monthly" | "quarterly" | "yearly",
    dayOfMonth: number,
  ) {
    setSettings((prev) => ({
      ...prev,
      [freq]: { ...prev[freq], dayOfMonth },
    }));
  }

  function setMonth(month: number) {
    setSettings((prev) => ({
      ...prev,
      yearly: { ...prev.yearly, month },
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/reflections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to save");
      }
      setNotification({
        type: "success",
        message: "Reflection settings saved",
      });
    } catch (e) {
      setNotification({
        type: "error",
        message: e instanceof Error ? e.message : "Failed to save",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-8">
        <h2 className="text-2xl font-semibold">Reflections</h2>
        <div className="flex flex-col gap-8">
          {FREQUENCIES.map((freq) => (
            <div key={freq} className="space-y-3">
              <div className="h-4 w-24 bg-muted rounded animate-pulse" />
              <div className="h-10 w-full max-w-xs bg-muted rounded-lg animate-pulse" />
            </div>
          ))}
          <div className="h-9 w-20 bg-muted rounded-md animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-semibold tracking-tight">Reflections</h2>
      <p className="text-muted-foreground text-sm max-w-xl">
        Turn reflections on or off and set when each type should run (date and
        time in your timezone).
      </p>

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
        {FREQUENCIES.map((freq) => (
          <div
            key={freq}
            className="rounded-lg border border-border/60 bg-card/50 p-4 space-y-4"
          >
            <Field orientation="horizontal" className="gap-4">
              <FieldContent>
                <FieldLabel
                  htmlFor={`reflection-${freq}`}
                  className="text-sm font-medium cursor-pointer"
                >
                  {FREQUENCY_LABELS[freq]} reflection
                </FieldLabel>
              </FieldContent>
              <Switch
                id={`reflection-${freq}`}
                checked={settings[freq].enabled}
                onCheckedChange={(checked) => setEnabled(freq, checked)}
              />
            </Field>

            {settings[freq].enabled && (
              <div className="pl-7 space-y-4 border-l-2 border-muted ml-1">
                {freq === "weekly" && (
                  <Field className="gap-1.5">
                    <FieldTitle className="text-[13px] font-medium tracking-[-0.13px] text-foreground">
                      Day of week
                    </FieldTitle>
                    <FieldContent>
                      <Select
                        value={String(settings.weekly.dayOfWeek ?? 1)}
                        onValueChange={(v) => setDayOfWeek(Number(v))}
                      >
                        <SelectTrigger className="h-10 w-full rounded-lg max-w-[200px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WEEKDAY_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FieldContent>
                  </Field>
                )}

                {(freq === "monthly" || freq === "quarterly") && (
                  <Field className="gap-1.5">
                    <FieldTitle className="text-[13px] font-medium tracking-[-0.13px] text-foreground">
                      Day of month
                    </FieldTitle>
                    <FieldContent>
                      <Select
                        value={String(settings[freq].dayOfMonth ?? 1)}
                        onValueChange={(v) => setDayOfMonth(freq, Number(v))}
                      >
                        <SelectTrigger className="h-10 w-full rounded-lg max-w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {dayOfMonthOptions(28).map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FieldContent>
                  </Field>
                )}

                {freq === "yearly" && (
                  <div className="flex flex-wrap gap-4">
                    <Field className="gap-1.5">
                      <FieldTitle className="text-[13px] font-medium tracking-[-0.13px] text-foreground">
                        Month
                      </FieldTitle>
                      <FieldContent>
                        <Select
                          value={String(settings.yearly.month ?? 1)}
                          onValueChange={(v) => setMonth(Number(v))}
                        >
                          <SelectTrigger className="h-10 w-full rounded-lg min-w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MONTH_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FieldContent>
                    </Field>
                    <Field className="gap-1.5">
                      <FieldTitle className="text-[13px] font-medium tracking-[-0.13px] text-foreground">
                        Day
                      </FieldTitle>
                      <FieldContent>
                        <Select
                          value={String(settings.yearly.dayOfMonth ?? 1)}
                          onValueChange={(v) =>
                            setDayOfMonth("yearly", Number(v))
                          }
                        >
                          <SelectTrigger className="h-10 w-full rounded-lg max-w-[100px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {dayOfMonthOptions(31).map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FieldContent>
                    </Field>
                  </div>
                )}

                <Field className="gap-1.5">
                  <FieldTitle className="text-[13px] font-medium tracking-[-0.13px] text-foreground">
                    Time
                  </FieldTitle>
                  <FieldDescription className="text-muted-foreground text-sm">
                    When to trigger the reflection (your timezone).
                  </FieldDescription>
                  <FieldContent>
                    <Input
                      type="time"
                      value={settings[freq].time}
                      onChange={(e) => setTime(freq, e.target.value)}
                      className="h-10 w-full max-w-[140px] rounded-lg"
                    />
                  </FieldContent>
                </Field>
              </div>
            )}
          </div>
        ))}

        <Button
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-lg w-fit"
        >
          {saving ? "Saving…" : "Save reflection settings"}
        </Button>
      </div>
    </div>
  );
}
