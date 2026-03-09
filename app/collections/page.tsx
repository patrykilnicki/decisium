"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { listDocuments, listCollections } from "@/app/actions/vault";
import { Button } from "@/components/ui/button";
import { CentralIcon } from "@/components/ui/central-icon";
import { formatDate } from "@/lib/datetime/format";
import { useUserTimezone } from "@/contexts/user-preferences-context";

interface VaultDocument {
  id: string;
  title: string;
  collection_id: string | null;
  updated_at: string | null;
}

interface VaultCollection {
  id: string;
  name: string;
}

export default function CollectionsPage() {
  const timezone = useUserTimezone();
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [collections, setCollections] = useState<VaultCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [docsResult, colsResult] = await Promise.all([
        listDocuments(),
        listCollections(),
      ]);
      if (docsResult.error) setError(docsResult.error.message);
      else setDocuments(docsResult.data);
      if (colsResult.error) {
        if (!docsResult.error) setError(colsResult.error.message);
      } else setCollections(colsResult.data);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="flex h-full flex-col overflow-y-auto p-6">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-2xl font-semibold">Collections</h1>
            <Link href="/collections/documents/new">
              <Button>
                <CentralIcon name="IconPlusSmall" size={18} className="mr-2" />
                New Document
              </Button>
            </Link>
          </div>

          {loading && (
            <div className="grid gap-8 md:grid-cols-[200px_1fr]">
              <aside className="flex flex-col gap-2">
                <Skeleton className="h-4 w-24" />
                <div className="space-y-1">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              </aside>
              <section className="space-y-4">
                <Skeleton className="h-4 w-20" />
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton
                      key={i}
                      className="h-14 w-full rounded-md border border-border"
                    />
                  ))}
                </div>
              </section>
            </div>
          )}
          {error && (
            <div className="text-destructive mb-4 rounded-md bg-destructive/10 p-3">
              {error}
            </div>
          )}

          {!loading && !error && (
            <div className="grid gap-8 md:grid-cols-[200px_1fr]">
              <aside className="flex flex-col gap-2">
                <h2 className="text-sm font-medium text-muted-foreground">
                  Collections
                </h2>
                {collections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No collections yet
                  </p>
                ) : (
                  <nav className="flex flex-col gap-1">
                    <Link
                      href="/collections"
                      className="rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      All documents
                    </Link>
                    {collections.map((c) => (
                      <Link
                        key={c.id}
                        href={`/collections/${c.id}`}
                        className="rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        {c.name}
                      </Link>
                    ))}
                  </nav>
                )}
              </aside>

              <section>
                <h2 className="mb-4 text-sm font-medium text-muted-foreground">
                  Documents
                </h2>
                {documents.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                    No documents yet. Create your first document to get started.
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
                              {formatDate(new Date(doc.updated_at), timezone)}
                            </span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
