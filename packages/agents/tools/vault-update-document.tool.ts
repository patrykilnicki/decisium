import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import * as vaultRepo from "@/lib/vault/repository";
import { chunkAndEmbedDocument } from "@/lib/vault/chunker";

export const vaultUpdateDocumentTool = new DynamicStructuredTool({
  name: "vault_update_document",
  description:
    "Update an existing document in the user's Collections. Use when the user asks to edit, update, or add to an existing document. Pass userId, document_id (get from vault_search results or from prior context), and at least one of: title and/or content_md. When content_md changes, the document is re-indexed for search.",
  schema: z.object({
    userId: z
      .string()
      .describe("The user ID (tenant) who owns the Collections"),
    document_id: z.string().uuid().describe("The document ID to update"),
    title: z
      .string()
      .optional()
      .describe("New title (optional; omit to keep current title)"),
    content_md: z
      .string()
      .optional()
      .describe(
        "New full markdown content (optional; omit to keep current content). When provided, replaces entire content and re-indexes.",
      ),
  }),
  func: async ({ userId, document_id, title, content_md }) => {
    if (!title && content_md === undefined) {
      return JSON.stringify({
        success: false,
        error: "Provide at least one of: title, content_md",
      });
    }

    try {
      const client = createAdminClient();

      const { data: existing, error: getError } = await vaultRepo.getDocument(
        client,
        document_id,
        userId,
      );

      if (getError || !existing) {
        return JSON.stringify({
          success: false,
          error: "Document not found or access denied",
        });
      }

      const payload: { title?: string; content_markdown?: string | null } = {};
      if (title !== undefined) payload.title = title;
      if (content_md !== undefined) payload.content_markdown = content_md;

      const { data: doc, error: updateError } = await vaultRepo.updateDocument(
        client,
        document_id,
        userId,
        payload as never,
      );

      if (updateError || !doc) {
        console.error("[vault_update_document] Update error:", updateError);
        return JSON.stringify({
          success: false,
          error: updateError?.message ?? "Failed to update document",
        });
      }

      await vaultRepo.addVaultChange(client, {
        document_id,
        actor_type: "agent",
        actor_id: null,
        action: "update_from_chat",
        patch: payload,
        summary: "Updated from Ask conversation",
      });

      if (content_md !== undefined) {
        try {
          await chunkAndEmbedDocument(client, document_id, content_md);
        } catch (e) {
          console.error("[vault_update_document] Chunking failed:", e);
        }
      }

      return JSON.stringify({
        success: true,
        document_id: doc.id,
        title: doc.title,
        message: "Document updated in Collections.",
      });
    } catch (error) {
      console.error("[vault_update_document] Error:", error);
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
});
