export function IntegrationsSectionSkeleton() {
  return (
    <div className="space-y-3 min-h-[200px]">
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
  );
}
