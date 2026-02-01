import { NextRequest, NextResponse } from "next/server";
import { processDailyEvent, processDailyMessage } from "@/app/actions/daily";

// Daily step mappings for reasoning UI
const DAILY_STEPS = [
  { stepId: "process", label: "Processing your message", order: 1 },
  { stepId: "memory", label: "Searching memories", order: 2 },
  { stepId: "generate", label: "Generating response", order: 3 },
] as const;

function formatSSE(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  const acceptHeader = request.headers.get("accept");
  const wantsStreaming = acceptHeader?.includes("text/event-stream");

  try {
    const body = await request.json();
    const { eventId, message } = body;

    // Support both eventId (legacy) and message (new flow)
    if (eventId) {
      const response = await processDailyEvent(eventId);
      return NextResponse.json({ response });
    }

    if (!message) {
      return NextResponse.json(
        { error: "Either eventId or message is required" },
        { status: 400 }
      );
    }

    // Streaming path: emit step events while processing
    if (wantsStreaming) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          let currentStepIndex = 0;

          const emitStepStarted = (stepIndex: number) => {
            const step = DAILY_STEPS[stepIndex];
            if (step) {
              controller.enqueue(
                encoder.encode(
                  formatSSE({
                    type: "step_started",
                    stepId: step.stepId,
                    label: step.label,
                    timestamp: Date.now(),
                  })
                )
              );
            }
          };

          const emitStepCompleted = (stepIndex: number) => {
            const step = DAILY_STEPS[stepIndex];
            if (step) {
              controller.enqueue(
                encoder.encode(
                  formatSSE({
                    type: "step_completed",
                    stepId: step.stepId,
                    timestamp: Date.now(),
                  })
                )
              );
            }
          };

          try {
            controller.enqueue(
              encoder.encode(
                formatSSE({ type: "run_started", timestamp: Date.now() })
              )
            );

            emitStepStarted(0);
            await delay(150);
            emitStepCompleted(0);
            currentStepIndex = 1;

            emitStepStarted(1);
            const stepProgressPromise = delay(400);

            const workPromise = processDailyMessage(message);

            await stepProgressPromise;
            emitStepCompleted(1);
            currentStepIndex = 2;

            emitStepStarted(2);
            const result = await workPromise;

            emitStepCompleted(2);

            controller.enqueue(
              encoder.encode(
                formatSSE({
                  type: "run_finished",
                  response: result.agentResponse,
                  classification: result.classification,
                  timestamp: Date.now(),
                })
              )
            );
            controller.close();
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : "An error occurred";
            controller.enqueue(
              encoder.encode(
                formatSSE({
                  type: "run_error",
                  error: errorMessage,
                  timestamp: Date.now(),
                })
              )
            );
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // Non-streaming path
    const result = await processDailyMessage(message);
    return NextResponse.json({
      response: result.agentResponse,
      classification: result.classification,
    });
  } catch (error: unknown) {
    console.error("Error processing daily message:", error);
    const message =
      error instanceof Error ? error.message : "Failed to process daily message";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
