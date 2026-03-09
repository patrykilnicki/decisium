import { Skeleton } from "@/components/ui/skeleton";

export function TodoPromptSettingsSectionSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-card/50 px-4 py-3"
          >
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-[18px] w-8 rounded-full shrink-0" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border/60 bg-card/50 p-4 space-y-3">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-64" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}
