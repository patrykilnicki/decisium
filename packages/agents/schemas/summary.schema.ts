import { z } from "zod";

export const DailySummaryContentSchema = z.object({
  facts: z.array(z.string()).min(2).max(4),
  insight: z.string(),
  suggestion: z.string().optional(),
});

/** Reflection-style daily summary (context, key_entry, identity_insight, etc.) */
export const DailySummaryContentReflectionSchema = z.object({
  context: z.string().optional(),
  key_entry: z.string().optional(),
  identity_insight: z.string().optional(),
  reflection_prompt: z.string().optional(),
  pattern_observation: z.string().optional(),
});

/** Productivity-style daily summary (score, time allocation, narrative) */
export const DailySummaryContentProductivitySchema = z.object({
  score: z.number().min(0).max(100),
  score_label: z.string(),
  explanation: z.string(),
  time_allocation: z.object({
    meetings: z.number().min(0).max(100),
    deep_work: z.number().min(0).max(100),
    other: z.number().min(0).max(100),
  }),
  notes_added: z.number().min(0),
  new_ideas: z.number().min(0),
  narrative_summary: z.string(),
});

export type DailySummaryContent =
  | z.infer<typeof DailySummaryContentSchema>
  | z.infer<typeof DailySummaryContentReflectionSchema>
  | z.infer<typeof DailySummaryContentProductivitySchema>;

export const DailySummarySchema = z.object({
  id: z.string().uuid().optional(),
  user_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  content: DailySummaryContentSchema,
  created_at: z.string().datetime().optional(),
});

export type DailySummary = z.infer<typeof DailySummarySchema>;

export const WeeklySummaryContentSchema = z.object({
  patterns: z.array(z.string()),
  themes: z.array(z.string()),
  insights: z.array(z.string()),
});

export type WeeklySummaryContent = z.infer<typeof WeeklySummaryContentSchema>;

export const WeeklySummarySchema = z.object({
  id: z.string().uuid().optional(),
  user_id: z.string().uuid(),
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  content: WeeklySummaryContentSchema,
  created_at: z.string().datetime().optional(),
});

export type WeeklySummary = z.infer<typeof WeeklySummarySchema>;

export const MonthlySummaryContentSchema = z.object({
  trends: z.array(z.string()),
  strategic_insights: z.array(z.string()),
  reflections: z.array(z.string()),
});

export type MonthlySummaryContent = z.infer<typeof MonthlySummaryContentSchema>;

export const MonthlySummarySchema = z.object({
  id: z.string().uuid().optional(),
  user_id: z.string().uuid(),
  month_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  content: MonthlySummaryContentSchema,
  created_at: z.string().datetime().optional(),
});

export type MonthlySummary = z.infer<typeof MonthlySummarySchema>;
