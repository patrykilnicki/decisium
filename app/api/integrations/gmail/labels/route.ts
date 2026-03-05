import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getGmailConnectedAccountId,
  listGmailLabels,
} from "@agents/lib/composio-gmail";

/**
 * GET /api/integrations/gmail/labels
 * Returns Gmail labels for the authenticated user (for todo email scope settings).
 * Requires Gmail to be connected.
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

    const connectedAccountId = await getGmailConnectedAccountId(user.id);
    if (!connectedAccountId) {
      return NextResponse.json(
        { error: "Connect Gmail in settings to load labels" },
        { status: 400 },
      );
    }

    const labels = await listGmailLabels(user.id);
    return NextResponse.json({ labels });
  } catch (err) {
    console.error("[gmail/labels] GET error:", err);
    return NextResponse.json(
      { error: "Failed to load Gmail labels" },
      { status: 500 },
    );
  }
}
