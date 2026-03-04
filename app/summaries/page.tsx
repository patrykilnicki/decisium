"use client";

import { SummariesContent } from "@/app/summaries/components/summaries-content";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";

export default function SummariesPage() {
  return (
    <ProtectedRoute>
      <AppLayout>
        <SummariesContent />
      </AppLayout>
    </ProtectedRoute>
  );
}
