import { Skeleton } from "@/components/ui/skeleton";

export function TodoEmailScopeSectionSkeleton() {
  return (
    <div className="space-y-4 min-h-[120px]">
      <Skeleton className="h-4 w-full max-w-md" />
      <Skeleton className="min-h-[80px] rounded-lg border border-border bg-muted/30" />
      <div className="flex gap-2 flex-wrap">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
    </div>
  );
}
