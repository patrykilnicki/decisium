import { z } from "zod";

export const MemoryMetadataSchema = z.object({
  type: z.enum([
    "daily_event",
    "daily_summary",
    "weekly_summary",
    "monthly_summary",
  ]),
  source_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type MemoryMetadata = z.infer<typeof MemoryMetadataSchema>;

export const MemoryFragmentSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  content: z.string(),
  metadata: MemoryMetadataSchema,
  similarity: z.number().min(0).max(1),
  created_at: z.string().datetime(),
});

export type MemoryFragment = z.infer<typeof MemoryFragmentSchema>;

export const MemoryRetrievalResultSchema = z.object({
  fragments: z.array(MemoryFragmentSchema),
  hierarchy_level: z.enum(["monthly", "weekly", "daily", "raw"]),
  total_found: z.number(),
});

export type MemoryRetrievalResult = z.infer<typeof MemoryRetrievalResultSchema>;
