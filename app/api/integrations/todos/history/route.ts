import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
      Math.max(1, Number(searchParams.get("limit") ?? 20)),
    );
    const offset = Math.max(0, Number(searchParams.get("offset") ?? 0));

    const { data, error } = await supabase
      .from("todo_snapshots")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

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
