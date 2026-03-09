"use client";

import { ConnectApps } from "./connect-apps";

export function IntegrationsSection() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold">Integrations</h2>
      </div>
      <ConnectApps returnTo="/settings" showNotification />
    </div>
  );
}
