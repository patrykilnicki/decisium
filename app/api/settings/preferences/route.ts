import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const THEME_VALUES = ["light", "dark", "system"] as const;
type ThemeValue = (typeof THEME_VALUES)[number];

function isValidTheme(v: unknown): v is ThemeValue {
  return typeof v === "string" && THEME_VALUES.includes(v as ThemeValue);
}

function isValidBody(body: unknown): body is {
  timezone?: string | null;
  theme?: ThemeValue | null;
} {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  if ("timezone" in o) {
    const v = o.timezone;
    if (v !== null && typeof v !== "string") return false;
  }
  if ("theme" in o) {
    const v = o.theme;
    if (v !== null && !isValidTheme(v)) return false;
  }
  return true;
}

/**
 * GET /api/settings/preferences
 * Returns the current user's preferences (timezone, theme).
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
      .select("timezone, theme")
      .eq("id", user.id)
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to load preferences" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      timezone: data?.timezone ?? null,
      theme: data?.theme ?? "system",
    });
  } catch (err) {
    console.error("[preferences] GET error:", err);
    return NextResponse.json(
      { error: "Failed to load preferences" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/settings/preferences
 * Update the current user's preferences (timezone, theme).
 * Body: { timezone?: string | null, theme?: 'light' | 'dark' | 'system' | null }
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
            "Invalid body: timezone (optional string or null), theme (optional 'light' | 'dark' | 'system' or null)",
        },
        { status: 400 },
      );
    }

    const payload: Record<string, string | null> = {};
    if (body.timezone !== undefined) payload.timezone = body.timezone ?? null;
    if (body.theme !== undefined) payload.theme = body.theme ?? "system";

    if (Object.keys(payload).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from("users")
      .update(payload)
      .eq("id", user.id);

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to update preferences" },
        { status: 500 },
      );
    }

    const { data } = await supabase
      .from("users")
      .select("timezone, theme")
      .eq("id", user.id)
      .single();

    return NextResponse.json({
      timezone: data?.timezone ?? null,
      theme: data?.theme ?? "system",
    });
  } catch (err) {
    console.error("[preferences] PATCH error:", err);
    return NextResponse.json(
      { error: "Failed to update preferences" },
      { status: 500 },
    );
  }
}
