import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getThreadMessages, sendMessage } from "@/app/actions/ask";
import { getOrderedSteps } from "@/packages/agents/lib/step-mappings";
import { ThinkingEvent } from "@/packages/agents/schemas/thinking.schema";

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
  const acceptHeader = request.headers.get("accept");

  // Check if client wants streaming response
  if (acceptHeader?.includes("text/event-stream")) {
    return handleStreamingMessage(request, { params });
  }

  // Non-streaming path (existing behavior)
  try {
    const { threadId } = await params;
    const body = await request.json();
    const { content } = body;

    if (!content) {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 }
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

// Helper to format SSE event
function formatSSE(event: ThinkingEvent | Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// Helper to create a delay
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Streaming message handler with simulated step progress
async function handleStreamingMessage(
  request: NextRequest,
  { params }: RouteParams
) {
  const encoder = new TextEncoder();

  try {
    const { threadId } = await params;
    const body = await request.json();
    const { content } = body;

    if (!content) {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 }
      );
    }

    // Verify user is authenticated
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify thread belongs to user
    const { data: thread } = await supabase
      .from("ask_threads")
      .select("id")
      .eq("id", threadId)
      .eq("user_id", user.id)
      .single();

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    // Get ordered steps for the linear mode
    const steps = getOrderedSteps("linear");

    // Create the stream
    const stream = new ReadableStream({
      async start(controller) {
        let currentStepIndex = 0;

        // Helper to emit current step as running
        const emitStepStarted = (stepIndex: number) => {
          const step = steps[stepIndex];
          if (step) {
            controller.enqueue(
              encoder.encode(
                formatSSE({
                  type: "step_started",
                  stepId: step.nodeId,
                  label: step.label,
                  timestamp: Date.now(),
                })
              )
            );
          }
        };

        // Helper to emit step as completed
        const emitStepCompleted = (stepIndex: number) => {
          const step = steps[stepIndex];
          if (step) {
            controller.enqueue(
              encoder.encode(
                formatSSE({
                  type: "step_completed",
                  stepId: step.nodeId,
                  timestamp: Date.now(),
                })
              )
            );
          }
        };

        try {
          // Emit run_started event
          controller.enqueue(
            encoder.encode(
              formatSSE({
                type: "run_started",
                timestamp: Date.now(),
              })
            )
          );

          // Start the first step
          emitStepStarted(currentStepIndex);

          // Start a background task to simulate step progression
          // Steps will progress while the actual work is being done
          const stepProgressPromise = (async () => {
            // Progress through steps with timing that approximates real execution
            // Step 1: Processing message (quick) - ~200ms
            await delay(200);
            emitStepCompleted(currentStepIndex);
            currentStepIndex++;
            emitStepStarted(currentStepIndex);

            // Step 2: Searching memories - ~500ms
            await delay(500);
            emitStepCompleted(currentStepIndex);
            currentStepIndex++;
            emitStepStarted(currentStepIndex);

            // Step 3: Generating response - this is the longest step
            // We'll complete it when the actual sendMessage finishes
          })();

          // Execute the actual message sending
          const result = await sendMessage(threadId, { content, role: "user" });

          // Wait for step progression to catch up
          await stepProgressPromise;

          // Complete the generation step
          emitStepCompleted(currentStepIndex);
          currentStepIndex++;

          // Final step: Saving response
          if (currentStepIndex < steps.length) {
            emitStepStarted(currentStepIndex);
            await delay(100);
            emitStepCompleted(currentStepIndex);
          }

          // Emit run_finished event with messages
          controller.enqueue(
            encoder.encode(
              formatSSE({
                type: "run_finished",
                content: result.assistantMessage?.content,
                userMessage: result.userMessage,
                assistantMessage: result.assistantMessage,
                timestamp: Date.now(),
              })
            )
          );

          controller.close();
        } catch (error) {
          // Emit error event
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
        "X-Accel-Buffering": "no", // Disable nginx buffering
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to process message";
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }
}
