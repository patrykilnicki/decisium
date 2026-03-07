export function TasksSectionSkeleton() {
  return (
    <>
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-border px-5 py-4 last:border-b-0"
        >
          <div className="h-4 w-4 shrink-0 animate-pulse rounded border border-input bg-muted" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="h-4 w-full max-w-sm animate-pulse rounded bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2 px-5 py-3">
        <div className="h-4 w-4 animate-pulse rounded bg-muted" />
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
      </div>
    </>
  );
}
