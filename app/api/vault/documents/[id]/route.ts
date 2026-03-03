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

  return NextResponse.json({
    id: data.id,
    title: data.title,
    collection_id: data.collection_id,
    ydoc_state: ydocBase64,
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
    };
    contentText = body.content_text?.trim();
    if (body.ydoc_state && typeof body.ydoc_state === "string") {
      ydocState = new Uint8Array(
        Buffer.from(body.ydoc_state, "base64") as unknown as ArrayBuffer,
      );
    }
    if (body.title !== undefined) {
      const { data, error } = await vaultRepo.updateDocument(
        supabase,
        id,
        user.id,
        { title: body.title },
      );
      if (error)
        return NextResponse.json(
          { error: error.message },
          { status: error.message.includes("not found") ? 404 : 500 },
        );
      if (body.ydoc_state === undefined)
        return NextResponse.json(data ?? { id, title: body.title });
    }
  }

  const { data, error } = await vaultRepo.updateDocument(
    supabase,
    id,
    user.id,
    { ydoc_state: ydocState ?? undefined },
  );
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: error.message.includes("not found") ? 404 : 500 },
    );
  }

  if (ydocState && ydocState.length > 0) {
    await vaultRepo.addVaultChange(supabase, {
      document_id: id,
      actor_type: "user",
      actor_id: user.id,
      action: "edit",
      patch: { type: "ydoc_update", size: ydocState.length },
      summary: "User edit",
    });
    await maybeCreateSnapshot(supabase, id);
  }

  if (contentText) {
    try {
      await chunkAndEmbedDocument(supabase, id, contentText);
    } catch (e) {
      console.error("[vault] Chunking failed:", e);
    }
  }

  return NextResponse.json(data ?? { id });
}
