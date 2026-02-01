import { z } from "zod";

export const DailySummaryContentSchema = z.object({
  facts: z.array(z.string()).min(2).max(4),
  insight: z.string(),
  suggestion: z.string().optional(),
});

export type DailySummaryContent = z.infer<typeof DailySummaryContentSchema>;

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
