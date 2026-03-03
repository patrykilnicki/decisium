import { z } from "zod";

export const VaultActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_document"),
    title: z.string(),
    content_md: z.string(),
    collection_id: z.string().uuid().optional(),
    source_atom_ids: z.array(z.string().uuid()).optional(),
  }),
  z.object({
    action: z.literal("append_to_document"),
    document_id: z.string().uuid(),
    content_md: z.string(),
    source_atom_ids: z.array(z.string().uuid()).optional(),
  }),
  z.object({
    action: z.literal("add_to_collection"),
    document_id: z.string().uuid(),
    collection_id: z.string().uuid(),
    source_atom_ids: z.array(z.string().uuid()).optional(),
  }),
]);

export type VaultAction = z.infer<typeof VaultActionSchema>;
