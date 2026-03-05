import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const TOGGLE_KEYS = [
  "fromCalendar",
  "fromEmails",
  "replyTasks",
  "fromNewsletters",
  "prepForMeetings",
  "fromAutomatedBots",
] as const;

const CUSTOM_INSTRUCTIONS_MAX_LENGTH = 1000;

function isValidToggles(
  v: unknown,
): v is Record<(typeof TOGGLE_KEYS)[number], boolean> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  for (const key of TOGGLE_KEYS) {
    if (!(key in o)) continue;
    if (typeof o[key] !== "boolean") return false;
  }
  return true;
}

function isValidBody(body: unknown): body is {
  toggles?: Record<(typeof TOGGLE_KEYS)[number], boolean>;
  customInstructions?: string | null;
} {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  if ("toggles" in o && !isValidToggles(o.toggles)) return false;
  if ("customInstructions" in o) {
    const v = o.customInstructions;
    if (v !== null && typeof v !== "string") return false;
    if (typeof v === "string" && v.length > CUSTOM_INSTRUCTIONS_MAX_LENGTH)
      return false;
  }
  return true;
}

/**
 * GET /api/settings/todo-prompt-settings
 * Returns the current user's todo prompt settings (toggles + custom instructions).
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
      .select("todo_prompt_settings")
      .eq("id", user.id)
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to load settings" },
        { status: 500 },
      );
    }

    const settings =
      (data?.todo_prompt_settings as Record<string, unknown> | null) ?? null;
    return NextResponse.json(settings);
  } catch (err) {
    console.error("[todo-prompt-settings] GET error:", err);
    return NextResponse.json(
      { error: "Failed to load todo prompt settings" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/settings/todo-prompt-settings
 * Update the current user's todo prompt settings.
 * Body: { toggles?: { fromCalendar?, fromEmails?, replyTasks?, fromNewsletters?, prepForMeetings?, fromAutomatedBots? }, customInstructions?: string | null }
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
          error: `Invalid body: toggles (optional object with ${TOGGLE_KEYS.join(", ")} booleans), customInstructions (optional string or null, max ${CUSTOM_INSTRUCTIONS_MAX_LENGTH} chars)`,
        },
        { status: 400 },
      );
    }

    const customInstructions =
      body.customInstructions === undefined
        ? undefined
        : typeof body.customInstructions === "string"
          ? body.customInstructions
              .trim()
              .slice(0, CUSTOM_INSTRUCTIONS_MAX_LENGTH)
          : null;

    const payload: Record<string, unknown> = {};
    if (body.toggles !== undefined) payload.toggles = body.toggles;
    if (customInstructions !== undefined)
      payload.customInstructions = customInstructions;

    const { data: existing } = await supabase
      .from("users")
      .select("todo_prompt_settings")
      .eq("id", user.id)
      .single();

    const existingObj =
      (existing?.todo_prompt_settings as Record<string, unknown> | null) ?? {};
    const merged = {
      ...existingObj,
      ...payload,
    };

    const { error } = await supabase
      .from("users")
      .update({ todo_prompt_settings: merged })
      .eq("id", user.id);

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to update settings" },
        { status: 500 },
      );
    }

    return NextResponse.json(merged);
  } catch (err) {
    console.error("[todo-prompt-settings] PATCH error:", err);
    return NextResponse.json(
      { error: "Failed to update todo prompt settings" },
      { status: 500 },
    );
  }
}
