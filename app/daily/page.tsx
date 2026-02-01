"use client";

import { DailyContent } from "@/components/daily/daily-content";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";

export default function DailyPage() {
  return (
    <ProtectedRoute>
      <AppLayout>
        <DailyContent />
      </AppLayout>
    </ProtectedRoute>
  );
}
