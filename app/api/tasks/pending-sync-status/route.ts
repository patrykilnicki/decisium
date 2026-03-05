import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/supabase/db";

/**
 * GET /api/tasks/pending-sync-status
 * Returns whether the current user has any integration.sync tasks still pending or in progress.
 * Used by the home page to show "Configuring dashboard" loader until sync completes.
 */
export async function GET() {
  const supabase = await createClient();
  const { user, error: authError } = await db.getAuthUser(supabase);

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: tasks, error } = await db.selectMany(
    supabase,
    "tasks",
    {
      user_id: user.id,
      task_type: "integration.sync",
      status: ["pending", "in_progress"],
    },
    { columns: "id", limit: 1 },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    hasPending: (tasks?.length ?? 0) > 0,
  });
}
