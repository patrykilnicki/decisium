import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/db";
import * as vaultRepo from "@/lib/vault/repository";
import { maybeCreateSnapshot } from "@/lib/vault/snapshot";
import { chunkAndEmbedDocument } from "@/lib/vault/chunker";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { user, error: authError } = await getAuthUser(supabase);
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await vaultRepo.getDocument(supabase, id, user.id);
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: error.message.includes("not found") ? 404 : 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let ydocBase64: string | null = null;
  if (data.ydoc_state) {
    const raw = data.ydoc_state as unknown;
    if (raw instanceof Uint8Array) {
      ydocBase64 = Buffer.from(raw).toString("base64");
    } else if (typeof raw === "string") {
      ydocBase64 = Buffer.from(raw, "hex").toString("base64");
    } else if (ArrayBuffer.isView(raw) || raw instanceof ArrayBuffer) {
      ydocBase64 = Buffer.from(raw as ArrayBuffer).toString("base64");
    }
  }

  const contentMarkdown = (data as { content_markdown?: string | null })
    .content_markdown;

  return NextResponse.json({
    id: data.id,
    title: data.title,
    collection_id: data.collection_id,
    ydoc_state: ydocBase64,
    content_markdown: contentMarkdown ?? null,
    created_at: data.created_at,
    updated_at: data.updated_at,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { user, error: authError } = await getAuthUser(supabase);
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let ydocState: Uint8Array | null = null;
  let contentText: string | undefined;
  const contentType = request.headers.get("content-type") ?? "";
  let contentMarkdown: string | null | undefined;
  let bodyTitle: string | undefined;

  if (contentType.includes("application/octet-stream")) {
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > 0) {
      ydocState = new Uint8Array(buffer);
    }
  } else if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      ydoc_state?: string;
      title?: string;
      content_text?: string;
      content_markdown?: string | null;
    };
    contentText = body.content_text?.trim();
    contentMarkdown = body.content_markdown;
    bodyTitle = body.title;
    if (body.ydoc_state && typeof body.ydoc_state === "string") {
      ydocState = new Uint8Array(
        Buffer.from(body.ydoc_state, "base64") as unknown as ArrayBuffer,
      );
    }
    if (
      bodyTitle !== undefined &&
      ydocState === undefined &&
      contentMarkdown === undefined
    ) {
      const { data: titleData, error: titleError } =
        await vaultRepo.updateDocument(supabase, id, user.id, {
          title: bodyTitle,
        });
      if (titleError)
        return NextResponse.json(
          { error: titleError.message },
          { status: titleError.message.includes("not found") ? 404 : 500 },
        );
      return NextResponse.json(titleData ?? { id, title: bodyTitle });
    }
  }

  const updatePayload: {
    title?: string;
    ydoc_state?: Uint8Array;
    content_markdown?: string | null;
  } = {};
  if (bodyTitle !== undefined) updatePayload.title = bodyTitle;
  if (ydocState !== undefined)
    updatePayload.ydoc_state = ydocState ?? undefined;
  if (contentMarkdown !== undefined)
    updatePayload.content_markdown = contentMarkdown;

  const { data, error } = await vaultRepo.updateDocument(
    supabase,
    id,
    user.id,
    updatePayload,
  );
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: error.message.includes("not found") ? 404 : 500 },
    );
  }

  const hasContentUpdate =
    (ydocState && ydocState.length > 0) || contentMarkdown !== undefined;
  if (hasContentUpdate) {
    await vaultRepo.addVaultChange(supabase, {
      document_id: id,
      actor_type: "user",
      actor_id: user.id,
      action: "edit",
      patch:
        contentMarkdown !== undefined
          ? { type: "markdown_update" }
          : { type: "ydoc_update", size: ydocState!.length },
      summary: "User edit",
    });
    await maybeCreateSnapshot(supabase, id);
  }

  const rawText = contentText ?? (contentMarkdown ?? "").trim();
  const textForChunking = rawText ? rawText : undefined;
  if (textForChunking) {
    try {
      await chunkAndEmbedDocument(supabase, id, textForChunking);
    } catch (e) {
      console.error("[vault] Chunking failed:", e);
    }
  }

  return NextResponse.json(data ?? { id });
}
