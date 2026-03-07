"use client";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { HomePageSkeleton } from "@/app/home/components/home-page-skeleton";

export default function HomeLoading() {
  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden overscroll-y-auto scroll-smooth">
          <HomePageSkeleton />
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
