import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createThread, getThreads } from "@/app/actions/ask";

export async function GET(request: NextRequest) {
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
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch threads" },
      { status: 400 }
    );
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
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create thread" },
      { status: 400 }
    );
  }
}
