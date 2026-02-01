import { z } from "zod";

export const DailyEventRoleSchema = z.enum(["user", "agent", "system"]);
export type DailyEventRole = z.infer<typeof DailyEventRoleSchema>;

export const DailyEventTypeSchema = z.enum([
  "note",
  "question",
  "note+question",
  "answer",
  "summary",
  "system",
]);
export type DailyEventType = z.infer<typeof DailyEventTypeSchema>;

export const DailyEventSchema = z.object({
  id: z.string().uuid().optional(),
  user_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  role: DailyEventRoleSchema,
  type: DailyEventTypeSchema,
  content: z.string().min(1),
  created_at: z.string().datetime().optional(),
});

export type DailyEvent = z.infer<typeof DailyEventSchema>;

export const DailyEventInputSchema = DailyEventSchema.omit({
  id: true,
  created_at: true,
});

export type DailyEventInput = z.infer<typeof DailyEventInputSchema>;
