"use client";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { SettingsPageSkeleton } from "@/app/settings/components/settings-page-skeleton";

export default function SettingsLoading() {
  return (
    <ProtectedRoute>
      <AppLayout>
        <SettingsPageSkeleton />
      </AppLayout>
    </ProtectedRoute>
  );
}
