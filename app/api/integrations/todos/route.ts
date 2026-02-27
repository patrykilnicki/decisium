import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createTodoGenerator } from "@/lib/integrations";
import { GenerateTodoListInputSchema } from "@/packages/agents/schemas/todo.schema";

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/**
 * GET /api/integrations/todos
 * Returns latest to-do snapshot or regenerates when mode=regenerate.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const rawMode = searchParams.get("mode") ?? "smart";
    const mode = rawMode === "smart" ? "regenerate" : rawMode;
    const inputResult = GenerateTodoListInputSchema.safeParse({
      userId: user.id,
      mode,
      persist: parseBoolean(searchParams.get("persist"), true),
      maxItems: searchParams.get("maxItems")
        ? Number(searchParams.get("maxItems"))
        : undefined,
      windowHours: searchParams.get("windowHours")
        ? Number(searchParams.get("windowHours"))
        : undefined,
    });

    if (!inputResult.success) {
      return NextResponse.json(
        {
          error: "Invalid todo generation input",
          details: inputResult.error.issues,
        },
        { status: 400 },
      );
    }

    const generator = createTodoGenerator(supabase);
    const payload =
      rawMode === "smart"
        ? await generator.generateSmart(inputResult.data, {
            generatedFromEvent: "api.integrations.todos.get.smart",
          })
        : await generator.generate(inputResult.data, {
            generatedFromEvent: "api.integrations.todos.get",
          });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch integration to-dos",
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/integrations/todos
 * Explicitly regenerate and optionally persist a to-do snapshot.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const inputResult = GenerateTodoListInputSchema.safeParse({
      userId: user.id,
      mode: body.mode ?? "regenerate",
      persist: body.persist ?? true,
      maxItems: body.maxItems,
      windowHours: body.windowHours,
    });

    if (!inputResult.success) {
      return NextResponse.json(
        {
          error: "Invalid todo generation input",
          details: inputResult.error.issues,
        },
        { status: 400 },
      );
    }

    const generator = createTodoGenerator(supabase);
    const payload = await generator.generate(inputResult.data, {
      generatedFromEvent: "api.integrations.todos.post",
    });
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to regenerate integration to-dos",
      },
      { status: 500 },
    );
  }
}
