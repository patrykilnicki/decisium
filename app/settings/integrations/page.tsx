"use client";

import { Suspense } from "react";
import { IntegrationsSection } from "@/app/settings/components";
import { IntegrationsSectionSkeleton } from "@/app/settings/components/integrations-section-skeleton";

function IntegrationsContent() {
  return <IntegrationsSection />;
}

export default function SettingsIntegrationsPage() {
  return (
    <Suspense fallback={<IntegrationsSectionSkeleton />}>
      <IntegrationsContent />
    </Suspense>
  );
}
