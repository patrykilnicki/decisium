"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { listDocuments } from "@/app/actions/vault";

interface VaultDocument {
  id: string;
  title: string;
  updated_at: string | null;
}

export default function CollectionPage() {
  const params = useParams();
  const collectionId = params.collectionId as string;
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const result = await listDocuments(collectionId);
      if (result.error) setError(result.error.message);
      else setDocuments(result.data);
      setLoading(false);
    }
    load();
  }, [collectionId]);

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="flex h-full flex-col overflow-y-auto p-6">
          <div className="mb-6">
            <Link
              href="/collections"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Back to Collections
            </Link>
          </div>

          {loading && <div className="text-muted-foreground">Loading...</div>}
          {error && (
            <div className="text-destructive mb-4 rounded-md bg-destructive/10 p-3">
              {error}
            </div>
          )}

          {!loading && !error && (
            <section>
              <h2 className="mb-4 text-xl font-semibold">
                Documents in collection
              </h2>
              {documents.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                  No documents in this collection.
                </div>
              ) : (
                <ul className="space-y-2">
                  {documents.map((doc) => (
                    <li key={doc.id}>
                      <Link
                        href={`/collections/documents/${doc.id}`}
                        className="block rounded-md border p-3 transition-colors hover:bg-muted/50"
                      >
                        <span className="font-medium">{doc.title}</span>
                        {doc.updated_at && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {new Date(doc.updated_at).toLocaleDateString()}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
