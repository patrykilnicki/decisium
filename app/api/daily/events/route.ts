import { NextRequest, NextResponse } from "next/server";
import { createDailyEvent, getDailyEvents } from "@/app/actions/daily";
import { DailyEventInputSchema } from "@/packages/agents/schemas/daily.schema";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = DailyEventInputSchema.parse(body);

    const event = await createDailyEvent(validated);
    return NextResponse.json(event, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create daily event";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get("date");

    if (!date) {
      return NextResponse.json(
        { error: "Date parameter is required" },
        { status: 400 }
      );
    }

    const events = await getDailyEvents(date);
    return NextResponse.json(events);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch daily events";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
