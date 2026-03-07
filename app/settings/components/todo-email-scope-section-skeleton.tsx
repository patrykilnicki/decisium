export function TodoEmailScopeSectionSkeleton() {
  return (
    <div className="space-y-4 min-h-[120px]">
      <div className="h-4 w-full max-w-md animate-pulse rounded bg-muted" />
      <div className="min-h-[80px] animate-pulse rounded-lg border border-border bg-muted/30" />
      <div className="flex gap-2 flex-wrap">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-8 w-20 animate-pulse rounded-full bg-muted"
          />
        ))}
      </div>
    </div>
  );
}
