"use client";

import { Suspense } from "react";
import { IntegrationsSection } from "@/app/settings/components";
import { IntegrationsSectionSkeleton } from "@/app/settings/components/integrations-section-skeleton";

function IntegrationsContent() {
  return (
    <div className="p-4">
      <div className="max-w-2xl">
        <IntegrationsSection />
      </div>
    </div>
  );
}

export default function SettingsIntegrationsPage() {
  return (
    <Suspense fallback={<IntegrationsSectionSkeleton />}>
      <IntegrationsContent />
    </Suspense>
  );
}
