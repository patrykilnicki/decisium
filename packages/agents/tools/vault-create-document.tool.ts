import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import * as vaultRepo from "@/lib/vault/repository";
import { chunkAndEmbedDocument } from "@/lib/vault/chunker";

export const vaultCreateDocumentTool = new DynamicStructuredTool({
  name: "vault_create_document",
  description:
    "Create a new document in the user's Collections (personal knowledge base). Use when the user asks to save a summary, note, or any content to Collections (e.g. 'save this to my collections', 'add a summary'). Pass userId, title, and content_md (markdown). Optional: collection_id to put the document in a specific collection.",
  schema: z.object({
    userId: z.string().describe("The user ID (tenant) who owns the Collections"),
    title: z
      .string()
      .describe("Short document title (e.g. 'Meeting summary Mar 3 2025')"),
    content_md: z
      .string()
      .describe(
        "Full document content in Markdown (summary, notes, or text to save)",
      ),
    collection_id: z
      .string()
      .uuid()
      .optional()
      .describe("Optional collection ID to store the document in"),
  }),
  func: async ({ userId, title, content_md, collection_id }) => {
    try {
      const client = createAdminClient();

      const { data: doc, error: createError } = await vaultRepo.createDocument(
        client,
        {
          tenant_id: userId,
          title,
          collection_id: collection_id ?? null,
          created_by: null,
          content_markdown: content_md,
        },
      );

      if (createError || !doc) {
        console.error("[vault_create_document] Create error:", createError);
        return JSON.stringify({
          success: false,
          error: createError?.message ?? "Failed to create document",
        });
      }

      await vaultRepo.addVaultChange(client, {
        document_id: doc.id,
        actor_type: "agent",
        actor_id: null,
        action: "create_from_chat",
        patch: { content_md },
        summary: "Created from Ask conversation",
      });

      try {
        await chunkAndEmbedDocument(client, doc.id, content_md);
      } catch (e) {
        console.error("[vault_create_document] Chunking failed:", e);
      }

      return JSON.stringify({
        success: true,
        document_id: doc.id,
        title: doc.title,
        message: "Document saved to Collections and indexed for search.",
      });
    } catch (error) {
      console.error("[vault_create_document] Error:", error);
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
});
