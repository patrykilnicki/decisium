import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTodoGenerator } from "@/lib/integrations";

function todayDateString(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * GET /api/integrations/todos?date=2026-02-27
 *
 * Returns tasks for the given date. If tasks already exist in the DB
 * for that date, returns them immediately. If not, generates new ones
 * from connected integrations (Composio) + LLM and persists them.
 *
 * Query params:
 * - date (YYYY-MM-DD, defaults to today)
 * - force=true to regenerate even if cached
 * - onlyFromCache=true return only existing snapshot, never generate (for non-today dates)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get("date") ?? todayDateString();
    const force = searchParams.get("force") === "true";
    const onlyFromCache = searchParams.get("onlyFromCache") === "true";

    const generator = createTodoGenerator(createAdminClient());

    if (onlyFromCache) {
      const snapshot = await generator.getCachedForDate(user.id, date);
      if (!snapshot) {
        return NextResponse.json({
          items: [],
          date,
          hasSnapshot: false,
        });
      }
      return NextResponse.json({ ...snapshot, hasSnapshot: true });
    }

    const payload = force
      ? await generator.regenerateForDate(user.id, date, {
          generatedFromEvent: "api.todos.get.force",
        })
      : await generator.getOrGenerateForDate(user.id, date, {
          generatedFromEvent: "api.todos.get",
        });

    return NextResponse.json({ ...payload, hasSnapshot: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch tasks",
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/integrations/todos
 * Force regenerate tasks for a given date.
 * Body: { date?: "YYYY-MM-DD" }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const date = typeof body.date === "string" ? body.date : todayDateString();

    const generator = createTodoGenerator(createAdminClient());
    const payload = await generator.regenerateForDate(user.id, date, {
      generatedFromEvent: "api.todos.post",
    });

    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to regenerate tasks",
      },
      { status: 500 },
    );
  }
}
