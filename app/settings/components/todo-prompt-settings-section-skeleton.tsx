export function TodoPromptSettingsSectionSkeleton() {
  return (
    <div className="space-y-4 min-h-[280px]">
      <div className="h-4 w-64 animate-pulse rounded bg-muted" />
      <div className="space-y-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex items-center justify-between py-2">
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            <div className="h-6 w-11 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="min-h-[80px] animate-pulse rounded-lg border border-border bg-muted/30" />
    </div>
  );
}
