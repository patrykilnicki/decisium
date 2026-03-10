"use client";

import dynamic from "next/dynamic";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { Skeleton } from "@/components/ui/skeleton";

const SummariesContent = dynamic(
  () =>
    import("@/app/summaries/components/summaries-content").then((m) => ({
      default: m.SummariesContent,
    })),
  {
    loading: () => (
      <div className="mx-auto w-full max-w-4xl space-y-8 p-4">
        <Skeleton className="h-9 w-48" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      </div>
    ),
  },
);

export default function SummariesPage() {
  return (
    <ProtectedRoute>
      <AppLayout>
        <SummariesContent />
      </AppLayout>
    </ProtectedRoute>
  );
}
