"use client";

import { ConnectApps } from "./connect-apps";

export function IntegrationsSection() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Connected Apps</h2>
        <p className="text-sm text-muted-foreground">
          Connect your apps to sync data and enable AI-powered insights
        </p>
      </div>
      <ConnectApps returnTo="/settings" showNotification />
    </div>
  );
}
