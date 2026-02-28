import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTodoGenerator } from "@/lib/integrations";

function todayDateString(): string {
  return new Date().toISOString().split("T")[0];
}

type ItemAction = "update" | "delete" | "move";

interface ItemActionBody {
  date: string;
  itemId: string;
  action: ItemAction;
  status?: "open" | "in_progress" | "done";
  title?: string;
  dueAt?: string | null;
  toDate?: string;
}

/**
 * PATCH /api/integrations/todos/items
 * Body: { date, itemId, action: "update" | "delete" | "move", status?, title?, dueAt?, toDate? }
 * - update: set status and/or title and/or dueAt
 * - delete: remove item from snapshot
 * - move: remove from date, add to toDate (requires toDate)
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

    const body = (await request.json().catch(() => ({}))) as ItemActionBody;
    const { date, itemId, action } = body;
    if (!date || !itemId || !action) {
      return NextResponse.json(
        { error: "date, itemId, and action are required" },
        { status: 400 },
      );
    }

    const generator = createTodoGenerator(createAdminClient());

    if (action === "delete") {
      const snapshot = await generator.removeItemFromSnapshot(
        user.id,
        date,
        itemId,
      );
      return NextResponse.json(snapshot);
    }

    if (action === "move") {
      const toDate = body.toDate ?? todayDateString();
      const { from, to } = await generator.moveItemToDate(
        user.id,
        date,
        toDate,
        itemId,
      );
      return NextResponse.json({ from, to });
    }

    if (action === "update") {
      const patch: {
        status?: "open" | "in_progress" | "done";
        title?: string;
        dueAt?: string | null;
      } = {};
      if (body.status !== undefined) patch.status = body.status;
      if (body.title !== undefined) patch.title = body.title;
      if (body.dueAt !== undefined) patch.dueAt = body.dueAt;
      const snapshot = await generator.updateItemInSnapshot(
        user.id,
        date,
        itemId,
        patch,
      );
      return NextResponse.json(snapshot);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update task";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
