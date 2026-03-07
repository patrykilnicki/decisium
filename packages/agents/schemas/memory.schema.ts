import { z } from "zod";

export const MemoryMetadataSchema = z.object({
  type: z.string(),
  source_id: z.string().optional(),
  source: z.string().optional(),
  memory_type: z.string().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  importance: z.number().optional(),
});

export type MemoryMetadata = z.infer<typeof MemoryMetadataSchema>;

export const MemoryFragmentSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  content: z.string(),
  metadata: MemoryMetadataSchema.optional(),
  similarity: z.number().min(0).max(1),
  created_at: z.string().datetime(),
  memory_type: z
    .enum(["semantic", "episodic", "procedural", "conversation", "task"])
    .optional(),
  source: z.string().optional(),
  source_id: z.string().optional(),
  importance: z.number().optional(),
  final_score: z.number().optional(),
});

export type MemoryFragment = z.infer<typeof MemoryFragmentSchema>;

export const MemoryRetrievalResultSchema = z.object({
  fragments: z.array(MemoryFragmentSchema),
  hierarchy_level: z.string(),
  total_found: z.number(),
});

export type MemoryRetrievalResult = z.infer<typeof MemoryRetrievalResultSchema>;
