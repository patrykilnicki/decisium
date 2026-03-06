"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ConnectApps } from "@/app/settings/components/connect-apps";
import { Loader2 } from "lucide-react";

interface StepConnectAppsProps {
  onComplete: () => void;
  isCompleting?: boolean;
}

export function StepConnectApps({
  onComplete,
  isCompleting = false,
}: StepConnectAppsProps) {
  const [hasAtLeastOneIntegration, setHasAtLeastOneIntegration] =
    useState(false);

  const handleConnectedCountChange = useCallback((connectedCount: number) => {
    setHasAtLeastOneIntegration(connectedCount >= 1);
  }, []);

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
        onConnectedCountChange={handleConnectedCountChange}
      />

      <div className="flex flex-col gap-2">
        <Button onClick={onComplete} className="w-full" disabled={isCompleting}>
          {isCompleting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Continuing...
            </>
          ) : (
            "Continue"
          )}
        </Button>
        {!hasAtLeastOneIntegration && (
          <Button
            variant="ghost"
            onClick={onComplete}
            className="w-full"
            disabled={isCompleting}
          >
            Skip for now
          </Button>
        )}
      </div>
    </div>
  );
}
