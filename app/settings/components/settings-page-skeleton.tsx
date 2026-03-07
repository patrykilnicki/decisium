export function SettingsPageSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <header className="border-b p-4">
        <div className="h-8 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-1 h-4 w-56 animate-pulse rounded bg-muted" />
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl space-y-8">
          {/* Integrations section skeleton */}
          <div className="space-y-4">
            <div className="h-6 w-32 animate-pulse rounded bg-muted" />
            <div className="h-4 w-72 animate-pulse rounded bg-muted" />
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
                    <div className="space-y-1">
                      <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                      <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                    </div>
                  </div>
                  <div className="h-9 w-20 animate-pulse rounded-md bg-muted" />
                </div>
              ))}
            </div>
          </div>

          {/* Todo email scope section skeleton */}
          <div className="space-y-4">
            <div className="h-6 w-40 animate-pulse rounded bg-muted" />
            <div className="h-4 w-64 animate-pulse rounded bg-muted" />
            <div className="min-h-[120px] animate-pulse rounded-lg border border-border bg-muted/30" />
          </div>

          {/* Todo prompt settings section skeleton */}
          <div className="space-y-4">
            <div className="h-6 w-44 animate-pulse rounded bg-muted" />
            <div className="h-4 w-80 animate-pulse rounded bg-muted" />
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center justify-between py-2">
                  <div className="h-4 w-48 animate-pulse rounded bg-muted" />
                  <div className="h-6 w-11 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
            <div className="min-h-[80px] animate-pulse rounded-lg border border-border bg-muted/30" />
          </div>

          {/* Account section skeleton */}
          <div className="space-y-4">
            <div className="h-6 w-20 animate-pulse rounded bg-muted" />
            <div className="h-4 w-52 animate-pulse rounded bg-muted" />
            <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
          </div>
        </div>
      </div>
    </div>
  );
}
