import { Skeleton } from "@/components/ui/skeleton";

export function SettingsContentSkeleton() {
  return (
    <div className="p-4">
      <div className="max-w-2xl space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-10 w-28" />
        </div>
      </div>
    </div>
  );
}
