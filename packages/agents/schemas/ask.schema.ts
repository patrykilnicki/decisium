import { z } from "zod";

export const AskMessageRoleSchema = z.enum(["user", "assistant", "system"]);
export type AskMessageRole = z.infer<typeof AskMessageRoleSchema>;

export const AskThreadSchema = z.object({
  id: z.string().uuid().optional(),
  user_id: z.string().uuid(),
  title: z.string().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

export type AskThread = z.infer<typeof AskThreadSchema>;

export const AskMessageSchema = z.object({
  id: z.string().uuid().optional(),
  thread_id: z.string().uuid(),
  role: AskMessageRoleSchema,
  content: z.string().min(1),
  created_at: z.string().datetime().optional(),
});

export type AskMessage = z.infer<typeof AskMessageSchema>;

export const AskMessageInputSchema = AskMessageSchema.omit({
  id: true,
  created_at: true,
});

export type AskMessageInput = z.infer<typeof AskMessageInputSchema>;
