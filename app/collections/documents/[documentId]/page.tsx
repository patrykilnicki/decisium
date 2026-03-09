"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { VaultEditor } from "@/app/collections/components/vault-editor";
import { getDocument, updateDocument } from "@/app/actions/vault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface DocumentData {
  id: string;
  title: string;
  ydoc_state: string | null;
  content_markdown: string | null;
}

export default function CollectionDocumentPage() {
  const params = useParams();
  const _router = useRouter();
  const documentId = params.documentId as string;
  const [doc, setDoc] = useState<DocumentData | null>(null);
  const [title, setTitle] = useState("Untitled");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data, error: fetchError } = await getDocument(documentId);
      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }
      if (!data) {
        setError("Document not found");
        setLoading(false);
        return;
      }
      setDoc({
        id: data.id,
        title: data.title,
        ydoc_state: data.ydoc_state ?? null,
        content_markdown: data.content_markdown ?? null,
      });
      setTitle(data.title);
      setLoading(false);
    }
    load();
  }, [documentId]);

  async function handleTitleBlur() {
    if (!doc || title === doc.title) return;
    await updateDocument(documentId, { title });
  }

  if (loading) {
    return (
      <ProtectedRoute>
        <AppLayout>
          <div className="flex h-full flex-col overflow-hidden">
            <header className="flex items-center gap-4 border-b px-4 py-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 max-w-md flex-1" />
            </header>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          </div>
        </AppLayout>
      </ProtectedRoute>
    );
  }

  if (error || !doc) {
    return (
      <ProtectedRoute>
        <AppLayout>
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
            <p className="text-destructive">{error ?? "Document not found"}</p>
            <Link href="/collections">
              <Button variant="outline">Back to Collections</Button>
            </Link>
          </div>
        </AppLayout>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="flex h-full flex-col overflow-hidden">
          <header className="flex items-center gap-4 border-b px-4 py-3">
            <Link
              href="/collections"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Collections
            </Link>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              className="max-w-md border-0 bg-transparent text-lg font-semibold focus-visible:ring-0"
              placeholder="Untitled"
            />
          </header>
          <div className="flex-1 overflow-y-auto">
            <VaultEditor
              documentId={documentId}
              initialTitle={doc.title}
              initialYdocBase64={doc.ydoc_state}
              initialContentMarkdown={doc.content_markdown}
            />
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
