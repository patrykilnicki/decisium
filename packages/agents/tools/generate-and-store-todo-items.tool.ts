import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import * as db from "@/lib/supabase/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLLM } from "../lib/llm";
import { getTaskContext } from "../lib/task-context";
import { getCurrentDate } from "../lib/date-utils";
import {
  taskApprovalCardPropsSchema,
  taskApprovalItemSchema,
} from "../schemas/agent-ui.schema";

// Optional fields must be .optional().nullable() for OpenAI structured output API
const GeneratedTodoItemSchema = taskApprovalItemSchema.extend({
  dueAt: z.string().datetime().optional().nullable(),
  confidence: z.number().min(0).max(1).optional().nullable(),
});

const GeneratedTodoListSchema = z.object({
  items: z.array(GeneratedTodoItemSchema),
});

function getResolvedUserId(userId?: string): string {
  const taskContext = getTaskContext();
  const resolvedUserId = userId ?? taskContext?.userId;
  if (!resolvedUserId) throw new Error("userId is required for todo tools");
  return resolvedUserId;
}

function getResolvedDate(date?: string): string {
  const taskContext = getTaskContext();
  return date ?? taskContext?.currentDate ?? getCurrentDate();
}

async function generateTodoItemsFromRequest(params: {
  request: string;
  date: string;
  maxItems: number;
  preferredModel?: string;
}) {
  const llm = createLLM({
    model: params.preferredModel || process.env.LLM_MODEL || "openai/gpt-4o",
    temperature: 0.2,
    maxTokens: 2000,
  }).withStructuredOutput(GeneratedTodoListSchema);

  const generated = await llm.invoke([
    {
      role: "system" as const,
      content:
        "Generate concise actionable todo tasks from the user request. Return only concrete actions. Keep each task unique. Use priority=urgent only for explicit deadlines or high urgency.",
    },
    {
      role: "user" as const,
      content: `Target date: ${params.date}\nMax items: ${params.maxItems}\nRequest: ${params.request}`,
    },
  ]);

  return generated.items.slice(0, params.maxItems);
}

export const proposeTodoItemsTool = new DynamicStructuredTool({
  name: "propose_todo_items",
  description:
    "Generate a task approval UI payload from the user's request. Do not save anything to the database.",
  schema: z.object({
    userId: z.string().uuid().optional().describe("Authenticated user id"),
    request: z
      .string()
      .min(1)
      .describe(
        "Natural language request from which tasks should be generated",
      ),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Task date in YYYY-MM-DD. Defaults to today."),
    maxItems: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe("Maximum number of tasks to generate"),
    preferredModel: z
      .string()
      .optional()
      .describe("Optional LLM model override"),
  }),
  func: async (args) => {
    const userId = getResolvedUserId(args.userId);
    const date = getResolvedDate(args.date);
    const items = await generateTodoItemsFromRequest({
      request: args.request,
      date,
      maxItems: args.maxItems,
      preferredModel: args.preferredModel,
    });
    const proposalId = crypto.randomUUID();
    const proposal = taskApprovalCardPropsSchema.parse({
      title: "AI suggests creating tasks",
      description: "Review and edit before saving.",
      date,
      request: args.request,
      items: items.map((item) => ({
        id: crypto.randomUUID(),
        title: item.title,
        summary: item.summary,
        priority: item.priority ?? "normal",
        suggestedNextAction: item.suggestedNextAction,
        dueAt: item.dueAt ?? `${date}T00:00:00.000Z`,
        tags: item.tags ?? ["ask"],
        confidence: item.confidence ?? 0.8,
      })),
    });

    return JSON.stringify({
      userId,
      proposalId,
      component: "task_approval_card",
      props: proposal,
    });
  },
});

export const applyApprovedTodoItemsTool = new DynamicStructuredTool({
  name: "apply_approved_todo_items",
  description:
    "Persist approved task proposal into todo_items. Use only after explicit human approval.",
  schema: z.object({
    userId: z.string().uuid().optional().describe("Authenticated user id"),
    proposalId: z.string().uuid(),
    props: taskApprovalCardPropsSchema,
  }),
  func: async (args) => {
    const userId = getResolvedUserId(args.userId);
    const proposal = taskApprovalCardPropsSchema.parse(args.props);
    const admin = createAdminClient();
    const rows = proposal.items.map((item) => ({
      user_id: userId,
      id: item.id,
      date: proposal.date,
      title: item.title,
      summary: item.summary,
      priority: item.priority ?? "normal",
      status: "open" as const,
      due_at: item.dueAt,
      source_provider: "ask",
      source_type: "manual_generation",
      source_ref: { request: proposal.request, proposalId: args.proposalId },
      confidence: item.confidence ?? 0.8,
      tags: item.tags ?? ["ask"],
      suggested_next_action: item.suggestedNextAction,
      updated_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error } = await db.upsert(admin, "todo_items", rows, {
        onConflict: "user_id,id",
      });
      if (error) throw new Error(`Failed to save todo items: ${error.message}`);
    }

    return JSON.stringify({
      userId,
      proposalId: args.proposalId,
      createdCount: rows.length,
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        summary: row.summary,
        priority: row.priority,
        status: row.status,
        dueAt: row.due_at,
        suggestedNextAction: row.suggested_next_action,
      })),
    });
  },
});
