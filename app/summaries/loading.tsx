/**
 * Lightweight loading fallback for /summaries: inline skeleton only.
 * No ProtectedRoute/AppLayout during loading (same pattern as home).
 */
export default function SummariesLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="shrink-0 border-b bg-background/95 p-4">
        <div className="mb-2 h-7 w-32 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-72 max-w-full animate-pulse rounded-md bg-muted" />
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-6">
          <div className="flex gap-2">
            <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
            <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
            <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
          </div>
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-32 w-full animate-pulse rounded-lg bg-muted"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
