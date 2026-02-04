import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createThread, getThreads } from "@/app/actions/ask";

export async function GET(_request: NextRequest) {
  // Route handler signature requires request; not used for list threads
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const threads = await getThreads(user.id);
    return NextResponse.json(threads);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch threads";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { title } = body;

    const thread = await createThread(user.id, title);
    return NextResponse.json(thread, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create thread";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
