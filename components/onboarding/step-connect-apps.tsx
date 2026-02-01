"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";

interface AppConnection {
  id: string;
  name: string;
  description: string;
  icon: ReactNode;
  connected: boolean;
}

import { ReactNode } from "react";

function GoogleCalendarIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none">
      <path
        d="M19.5 3.75H4.5C3.67157 3.75 3 4.42157 3 5.25V19.5C3 20.3284 3.67157 21 4.5 21H19.5C20.3284 21 21 20.3284 21 19.5V5.25C21 4.42157 20.3284 3.75 19.5 3.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3 9H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.5 1.5V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 1.5V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GmailIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 4H20C21.1 4 22 4.9 22 6V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6C2 4.9 2.9 4 4 4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M22 6L12 13L2 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface StepConnectAppsProps {
  onComplete: () => void;
}

export function StepConnectApps({ onComplete }: StepConnectAppsProps) {
  const [apps, setApps] = useState<AppConnection[]>([
    {
      id: "google-calendar",
      name: "Google Calendar",
      description: "Sync your calendar events",
      icon: <GoogleCalendarIcon />,
      connected: false,
    },
    {
      id: "gmail",
      name: "Gmail",
      description: "Access your emails",
      icon: <GmailIcon />,
      connected: false,
    },
  ]);
  const [isLoading, setIsLoading] = useState<string | null>(null);

  async function handleConnect(appId: string) {
    setIsLoading(appId);
    // TODO: Implement actual OAuth connection
    // For now, simulate connection
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setApps((prev) =>
      prev.map((app) =>
        app.id === appId ? { ...app, connected: !app.connected } : app
      )
    );
    setIsLoading(null);
  }

  function handleContinue() {
    onComplete();
  }

  function handleSkip() {
    onComplete();
  }

  const hasAnyConnection = apps.some((app) => app.connected);

  return (
    <div className="w-full space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground">Connect Your Apps</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect your daily apps to get personalized insights
        </p>
      </div>

      <div className="space-y-3">
        {apps.map((app) => (
          <Card key={app.id} size="sm">
            <CardContent className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  {app.icon}
                </div>
                <div>
                  <CardTitle className="text-sm">{app.name}</CardTitle>
                  <CardDescription className="text-xs">
                    {app.description}
                  </CardDescription>
                </div>
              </div>
              <Button
                variant={app.connected ? "outline" : "default"}
                size="sm"
                onClick={() => handleConnect(app.id)}
                disabled={isLoading === app.id}
              >
                {isLoading === app.id
                  ? "..."
                  : app.connected
                    ? "Disconnect"
                    : "Connect"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Button onClick={handleContinue} className="w-full">
          {hasAnyConnection ? "Continue" : "Continue without connecting"}
        </Button>
        {!hasAnyConnection && (
          <Button variant="ghost" onClick={handleSkip} className="w-full">
            Skip for now
          </Button>
        )}
      </div>
    </div>
  );
}
