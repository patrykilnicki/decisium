"use client";

import { Button } from "@/components/ui/button";
import { ConnectApps } from "@/app/settings/components/connect-apps";

interface StepConnectAppsProps {
  onComplete: () => void;
}

export function StepConnectApps({ onComplete }: StepConnectAppsProps) {
  return (
    <div className="w-full space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground">
          Connect Your Apps
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect your daily apps to get personalized insights
        </p>
      </div>

      <ConnectApps
        returnTo="/onboarding"
        providersFilter={["google_calendar", "gmail"]}
        showNotification={false}
        showSyncModalOnConnect={false}
      />

      <div className="flex flex-col gap-2">
        <Button onClick={onComplete} className="w-full">
          Continue
        </Button>
        <Button variant="ghost" onClick={onComplete} className="w-full">
          Skip for now
        </Button>
      </div>
    </div>
  );
}
