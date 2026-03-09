import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/supabase";

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
  time: string; // HH:mm
  dayOfWeek?: number; // 0–6, weekly
  dayOfMonth?: number; // 1–28/31, monthly/quarterly/yearly
  month?: number; // 1–12, yearly
}

interface ReflectionSettings {
  daily?: ReflectionSchedule;
  weekly?: ReflectionSchedule;
  monthly?: ReflectionSchedule;
  quarterly?: ReflectionSchedule;
  yearly?: ReflectionSchedule;
}

const TIME_REGEX = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function isValidSchedule(s: unknown, freq: Frequency): s is ReflectionSchedule {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  if (typeof o.enabled !== "boolean") return false;
  if (typeof o.time !== "string" || !TIME_REGEX.test(o.time)) return false;
  if (freq === "weekly" && o.dayOfWeek !== undefined) {
    const n = Number(o.dayOfWeek);
    if (!Number.isInteger(n) || n < 0 || n > 6) return false;
  }
  if (
    ["monthly", "quarterly", "yearly"].includes(freq) &&
    o.dayOfMonth !== undefined
  ) {
    const n = Number(o.dayOfMonth);
    const max = freq === "yearly" ? 31 : 28;
    if (!Number.isInteger(n) || n < 1 || n > max) return false;
  }
  if (freq === "yearly" && o.month !== undefined) {
    const n = Number(o.month);
    if (!Number.isInteger(n) || n < 1 || n > 12) return false;
  }
  return true;
}

function isValidBody(body: unknown): body is ReflectionSettings {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  for (const freq of FREQUENCIES) {
    if (!(freq in o)) continue;
    if (!isValidSchedule(o[freq], freq)) return false;
  }
  return true;
}

const DEFAULT_SETTINGS: Record<Frequency, ReflectionSchedule> = {
  daily: { enabled: false, time: "09:00" },
  weekly: { enabled: false, time: "09:00", dayOfWeek: 1 },
  monthly: { enabled: false, time: "09:00", dayOfMonth: 1 },
  quarterly: { enabled: false, time: "09:00", dayOfMonth: 1 },
  yearly: { enabled: false, time: "09:00", month: 1, dayOfMonth: 1 },
};

function mergeWithDefaults(raw: ReflectionSettings | null): ReflectionSettings {
  const out: ReflectionSettings = {};
  for (const freq of FREQUENCIES) {
    const def = DEFAULT_SETTINGS[freq];
    const cur = raw?.[freq];
    out[freq] = {
      enabled: cur?.enabled ?? def.enabled,
      time: cur?.time ?? def.time,
      ...(freq === "weekly" && {
        dayOfWeek: cur?.dayOfWeek ?? def.dayOfWeek,
      }),
      ...(freq === "monthly" && {
        dayOfMonth: cur?.dayOfMonth ?? def.dayOfMonth,
      }),
      ...(freq === "quarterly" && {
        dayOfMonth: cur?.dayOfMonth ?? def.dayOfMonth,
      }),
      ...(freq === "yearly" && {
        month: cur?.month ?? def.month,
        dayOfMonth: cur?.dayOfMonth ?? def.dayOfMonth,
      }),
    };
  }
  return out;
}

/**
 * GET /api/settings/reflections
 * Returns the current user's reflection settings.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("users")
      .select("reflection_settings")
      .eq("id", user.id)
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to load reflection settings" },
        { status: 500 },
      );
    }

    const settings = mergeWithDefaults(
      (data?.reflection_settings as ReflectionSettings) ?? null,
    );
    return NextResponse.json(settings);
  } catch (err) {
    console.error("[reflections] GET error:", err);
    return NextResponse.json(
      { error: "Failed to load reflection settings" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/settings/reflections
 * Update the current user's reflection settings.
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    if (!isValidBody(body)) {
      return NextResponse.json(
        {
          error:
            "Invalid body: each frequency (daily, weekly, monthly, quarterly, yearly) may have { enabled, time (HH:mm), dayOfWeek?, dayOfMonth?, month? }",
        },
        { status: 400 },
      );
    }

    const { data: existing } = await supabase
      .from("users")
      .select("reflection_settings")
      .eq("id", user.id)
      .single();

    const current = (existing?.reflection_settings as ReflectionSettings) ?? {};
    const merged: ReflectionSettings = {};
    for (const freq of FREQUENCIES) {
      const def = DEFAULT_SETTINGS[freq];
      const cur = current[freq];
      const patch = body[freq];
      if (!patch) {
        merged[freq] = { ...def, ...cur } as ReflectionSchedule;
        continue;
      }
      merged[freq] = {
        enabled: patch.enabled,
        time: patch.time,
        ...(freq === "weekly" && {
          dayOfWeek: patch.dayOfWeek ?? cur?.dayOfWeek ?? def.dayOfWeek,
        }),
        ...(freq === "monthly" && {
          dayOfMonth: patch.dayOfMonth ?? cur?.dayOfMonth ?? def.dayOfMonth,
        }),
        ...(freq === "quarterly" && {
          dayOfMonth: patch.dayOfMonth ?? cur?.dayOfMonth ?? def.dayOfMonth,
        }),
        ...(freq === "yearly" && {
          month: patch.month ?? cur?.month ?? def.month,
          dayOfMonth: patch.dayOfMonth ?? cur?.dayOfMonth ?? def.dayOfMonth,
        }),
      } as ReflectionSchedule;
    }

    const { error } = await supabase
      .from("users")
      .update({ reflection_settings: merged as Json })
      .eq("id", user.id);

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to update reflection settings" },
        { status: 500 },
      );
    }

    return NextResponse.json(merged);
  } catch (err) {
    console.error("[reflections] PATCH error:", err);
    return NextResponse.json(
      { error: "Failed to update reflection settings" },
      { status: 500 },
    );
  }
}
