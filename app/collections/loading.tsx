/**
 * Lightweight loading fallback for /collections: inline skeleton only.
 * No ProtectedRoute/AppLayout during loading.
 */
export default function CollectionsLoading() {
  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
        <div className="h-10 w-32 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="grid gap-8 md:grid-cols-[200px_1fr]">
        <aside className="flex flex-col gap-2">
          <div className="h-4 w-24 animate-pulse rounded-md bg-muted" />
          <div className="space-y-1">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-8 w-full animate-pulse rounded-md bg-muted"
              />
            ))}
          </div>
        </aside>
        <section className="space-y-4">
          <div className="h-4 w-20 animate-pulse rounded-md bg-muted" />
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-14 w-full animate-pulse rounded-md border border-border bg-muted/50"
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
