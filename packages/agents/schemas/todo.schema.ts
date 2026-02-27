import { z } from "zod";

export const TodoPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type TodoPriority = z.infer<typeof TodoPrioritySchema>;

export const TodoStatusSchema = z.enum(["open", "in_progress", "done"]);
export type TodoStatus = z.infer<typeof TodoStatusSchema>;

export const TodoSourceRefSchema = z.object({
  integrationId: z.string().uuid().optional(),
  activityAtomId: z.string().uuid().optional(),
  externalId: z.string().optional(),
  sourceUrl: z.string().url().optional(),
});
export type TodoSourceRef = z.infer<typeof TodoSourceRefSchema>;

export const TodoItemSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  summary: z.string().min(1),
  priority: TodoPrioritySchema,
  status: TodoStatusSchema.default("open"),
  dueAt: z.string().nullable(),
  sourceProvider: z.string(),
  sourceType: z.string(),
  sourceRef: TodoSourceRefSchema,
  confidence: z.number().min(0).max(1),
  tags: z.array(z.string()),
  suggestedNextAction: z.string().min(1),
});
export type TodoItem = z.infer<typeof TodoItemSchema>;

export const TodoListStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  byPriority: z.object({
    low: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    urgent: z.number().int().nonnegative(),
  }),
  byProvider: z.record(z.number().int().nonnegative()),
});
export type TodoListStats = z.infer<typeof TodoListStatsSchema>;

export const TodoUpdateReasonSchema = z.enum([
  "initial_generation",
  "new_integration_context",
  "webhook_change_detected",
  "manual_regeneration",
  "resolved_items_pruned",
  "no_changes_detected",
  "cached",
]);
export type TodoUpdateReason = z.infer<typeof TodoUpdateReasonSchema>;

export const TodoListOutputSchema = z.object({
  listId: z.string().uuid(),
  userId: z.string().uuid(),
  date: z.string(),
  generatedAt: z.string().datetime(),
  updatedBecause: TodoUpdateReasonSchema,
  items: z.array(TodoItemSchema),
  stats: TodoListStatsSchema,
  version: z.literal("1.0"),
});
export type TodoListOutput = z.infer<typeof TodoListOutputSchema>;
