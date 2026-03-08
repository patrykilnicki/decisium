import { Skeleton } from "@/components/ui/skeleton";

export function TodoPromptSettingsSectionSkeleton() {
  return (
    <div className="space-y-4 min-h-[280px]">
      <Skeleton className="h-4 w-64" />
      <div className="space-y-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex items-center justify-between py-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-6 w-11" />
          </div>
        ))}
      </div>
      <Skeleton className="min-h-[80px] rounded-lg border border-border bg-muted/30" />
    </div>
  );
}
