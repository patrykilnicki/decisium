import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/supabase/db";

/**
 * GET /api/integrations/todos/history
 * Fetch paginated to-do snapshot history for the authenticated user.
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
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(searchParams.get("limit") ?? "20", 10) || 20),
    );
    const offset = Math.max(
      0,
      Number.parseInt(searchParams.get("offset") ?? "0", 10) || 0,
    );

    const { data, error } = await db.selectMany(
      supabase,
      "todo_snapshots",
      { user_id: user.id },
      {
        order: { column: "created_at", ascending: false },
        limit,
        offset,
      },
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      items: data ?? [],
      pagination: {
        limit,
        offset,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch to-do snapshot history",
      },
      { status: 500 },
    );
  }
}
