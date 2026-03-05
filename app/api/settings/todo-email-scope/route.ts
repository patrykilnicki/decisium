import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/settings/todo-email-scope
 * Returns the current user's todo email scope (label/sender filters for to-do generation).
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
      .select("todo_email_scope")
      .eq("id", user.id)
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to load settings" },
        { status: 500 },
      );
    }

    const scope =
      (data?.todo_email_scope as Record<string, unknown> | null) ?? null;
    return NextResponse.json(scope);
  } catch (err) {
    console.error("[todo-email-scope] GET error:", err);
    return NextResponse.json(
      { error: "Failed to load todo email scope" },
      { status: 500 },
    );
  }
}

function isValidScopeBody(body: unknown): body is {
  labelIdsAccepted?: string[];
  labelIdsBlocked?: string[];
  sendersAccepted?: string[];
  sendersBlocked?: string[];
} {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  const keys = [
    "labelIdsAccepted",
    "labelIdsBlocked",
    "sendersAccepted",
    "sendersBlocked",
  ];
  for (const key of keys) {
    if (!(key in o)) continue;
    const v = o[key];
    if (!Array.isArray(v)) return false;
    if (v.some((x) => typeof x !== "string")) return false;
  }
  return true;
}

/**
 * PATCH /api/settings/todo-email-scope
 * Update the current user's todo email scope.
 * Body: { labelIdsAccepted?, labelIdsBlocked?, sendersAccepted?, sendersBlocked? } (each optional string[]).
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
    if (!isValidScopeBody(body)) {
      return NextResponse.json(
        {
          error:
            "Invalid body: expected labelIdsAccepted, labelIdsBlocked, sendersAccepted, sendersBlocked (optional string[])",
        },
        { status: 400 },
      );
    }

    const scope = {
      labelIdsAccepted: body.labelIdsAccepted ?? [],
      labelIdsBlocked: body.labelIdsBlocked ?? [],
      sendersAccepted: body.sendersAccepted ?? [],
      sendersBlocked: body.sendersBlocked ?? [],
    };
    const hasAny =
      scope.labelIdsAccepted.length > 0 ||
      scope.labelIdsBlocked.length > 0 ||
      scope.sendersAccepted.length > 0 ||
      scope.sendersBlocked.length > 0;

    const { error } = await supabase
      .from("users")
      .update({ todo_email_scope: hasAny ? scope : null })
      .eq("id", user.id);

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to update settings" },
        { status: 500 },
      );
    }

    return NextResponse.json(scope);
  } catch (err) {
    console.error("[todo-email-scope] PATCH error:", err);
    return NextResponse.json(
      { error: "Failed to update todo email scope" },
      { status: 500 },
    );
  }
}
