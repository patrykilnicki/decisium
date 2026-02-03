import { NextRequest, NextResponse } from "next/server";
import { processDailyEvent, processDailyMessage } from "@/app/actions/daily";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { eventId, message } = body;

    // Support both eventId (legacy) and message (new flow)
    if (eventId) {
      const response = await processDailyEvent(eventId);
      return NextResponse.json(response);
    }

    if (!message) {
      return NextResponse.json(
        { error: "Either eventId or message is required" },
        { status: 400 }
      );
    }

    const result = await processDailyMessage(message);
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Error processing daily message:", error);
    const message =
      error instanceof Error ? error.message : "Failed to process daily message";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
