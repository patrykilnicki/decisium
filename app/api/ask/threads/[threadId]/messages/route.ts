import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getThreadMessages, sendMessage } from "@/app/actions/ask";
type RouteParams = { params: Promise<{ threadId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { threadId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const messages = await getThreadMessages(threadId, user.id);
    return NextResponse.json(messages);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch messages";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { threadId } = await params;
    const body = await request.json();
    const { content } = body;

    if (!content) {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 },
      );
    }

    const result = await sendMessage(threadId, { content, role: "user" });
    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to send message";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
