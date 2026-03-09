import { Skeleton } from "@/components/ui/skeleton";

export function TodoEmailScopeSectionSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="rounded-lg border border-border/60 bg-card/50 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-52" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-20 rounded-full" />
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-border/60 bg-card/50 p-4 space-y-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-72" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    </div>
  );
}
