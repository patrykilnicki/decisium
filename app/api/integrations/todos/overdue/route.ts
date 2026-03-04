import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTodoGenerator } from "@/lib/integrations";

/**
 * GET /api/integrations/todos/overdue?days=2
 * Returns open (non-done) tasks from the previous N days for the current user.
 * Used on Today view to show "Overdue" section.
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

    const days = Math.min(
      7,
      Math.max(
        1,
        parseInt(request.nextUrl.searchParams.get("days") ?? "2", 10),
      ),
    );
    const today = request.nextUrl.searchParams.get("today") ?? undefined;
    const generator = createTodoGenerator(createAdminClient());
    const items = await generator.getOverdueItems(user.id, { days, today });
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch overdue tasks",
      },
      { status: 500 },
    );
  }
}
