export function CalendarSectionSkeleton() {
  return (
    <div className="flex min-h-[180px] flex-col gap-1">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex gap-3 rounded-xl bg-muted/50 px-2 py-2">
          <div className="w-[3px] shrink-0 self-stretch animate-pulse rounded bg-muted" />
          <div className="flex flex-1 flex-col gap-1 py-0.5">
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
