import { Skeleton } from "@/components/ui/skeleton";

export function TasksSectionSkeleton() {
  return (
    <>
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-border px-5 py-4 last:border-b-0"
        >
          <Skeleton className="h-4 w-4 shrink-0 rounded border border-input" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Skeleton className="h-4 w-full max-w-sm" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2 px-5 py-3">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-20" />
      </div>
    </>
  );
}
