"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { IntegrationCard } from "./integration-card";
import { Calendar, Mail, FileText, CheckSquare } from "lucide-react";

interface Integration {
  id: string;
  provider: string;
  status: string;
  externalEmail?: string;
  connectedAt?: string;
  lastSyncAt?: string;
  lastSyncStatus?: "success" | "error" | "partial";
}

interface IntegrationStatus {
  connected: boolean;
  provider: string;
  integration?: Integration;
}

const INTEGRATIONS_CONFIG = [
  {
    provider: "google_calendar",
    displayName: "Google Calendar",
    description: "Sync calendar events and meeting schedules",
    icon: <Calendar className="h-6 w-6" />,
  },
  {
    provider: "gmail",
    displayName: "Gmail",
    description: "Sync emails and communication history",
    icon: <Mail className="h-6 w-6" />,
    disabled: true, // Coming soon
  },
  {
    provider: "notion",
    displayName: "Notion",
    description: "Sync pages, databases, and notes",
    icon: <FileText className="h-6 w-6" />,
    disabled: true, // Coming soon
  },
  {
    provider: "linear",
    displayName: "Linear",
    description: "Sync issues, projects, and tasks",
    icon: <CheckSquare className="h-6 w-6" />,
    disabled: true, // Coming soon
  },
];

export function IntegrationsSection() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [integrations, setIntegrations] = useState<Record<string, IntegrationStatus>>({});
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const fetchIntegrations = useCallback(async () => {
    try {
      const response = await fetch("/api/integrations");
      if (!response.ok) throw new Error("Failed to fetch integrations");
      
      const data = await response.json();
      const statusMap: Record<string, IntegrationStatus> = {};
      
      // Initialize all providers as disconnected
      INTEGRATIONS_CONFIG.forEach((config) => {
        statusMap[config.provider] = {
          connected: false,
          provider: config.provider,
        };
      });
      
      // Update with actual integration data
      data.integrations.forEach((integration: Integration) => {
        statusMap[integration.provider] = {
          connected: integration.status === "active",
          provider: integration.provider,
          integration,
        };
      });
      
      setIntegrations(statusMap);
    } catch (error) {
      console.error("Error fetching integrations:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  // Handle URL parameters for connection status
  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    if (connected) {
      setNotification({
        type: "success",
        message: `Successfully connected to ${connected.replace("_", " ")}! Syncing events...`,
      });
      // Refresh integrations list immediately
      fetchIntegrations();
      
      // Poll for sync completion (check every 2 seconds for up to 30 seconds)
      let pollCount = 0;
      const maxPolls = 15; // 30 seconds total
      const pollInterval = setInterval(async () => {
        pollCount++;
        
        // Fetch fresh data
        try {
          const response = await fetch("/api/integrations");
          if (response.ok) {
            const data = await response.json();
            const integration = data.integrations.find((i: Integration) => i.provider === connected);
            
            // Check if sync completed
            if (integration?.last_sync_at || pollCount >= maxPolls) {
              clearInterval(pollInterval);
              if (integration?.last_sync_at) {
                setNotification({
                  type: "success",
                  message: `Successfully synced events from ${connected.replace("_", " ")}!`,
                });
                // Refresh one more time to update UI
                fetchIntegrations();
              } else if (pollCount >= maxPolls) {
                // Timeout - sync might still be running
                setNotification({
                  type: "success",
                  message: `Connected to ${connected.replace("_", " ")}! Sync in progress...`,
                });
              }
            }
          }
        } catch (err) {
          console.error("Error polling sync status:", err);
        }
      }, 2000);
      
      // Clear URL params
      router.replace("/settings");
      
      // Cleanup interval on unmount
      return () => clearInterval(pollInterval);
    } else if (error) {
      setNotification({
        type: "error",
        message: errorDescription || `Connection failed: ${error}`,
      });
      router.replace("/settings");
    }
  }, [searchParams, fetchIntegrations, router]);

  // Clear notification after 5 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  async function handleConnect(provider: string) {
    try {
      const response = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to start connection");
      }

      const data = await response.json();
      
      // Redirect to OAuth authorization URL
      window.location.href = data.authorizationUrl;
    } catch (error) {
      console.error("Error connecting:", error);
      setNotification({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to connect",
      });
    }
  }

  async function handleDisconnect(provider: string) {
    try {
      const response = await fetch(`/api/integrations/${provider}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to disconnect");
      }

      setNotification({
        type: "success",
        message: `Disconnected from ${provider.replace("_", " ")}`,
      });
      
      // Refresh integrations list
      fetchIntegrations();
    } catch (error) {
      console.error("Error disconnecting:", error);
      setNotification({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to disconnect",
      });
    }
  }

  async function handleSync(provider: string) {
    try {
      const response = await fetch(`/api/integrations/${provider}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullSync: true }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Sync failed");
      }

      const data = await response.json();
      const count = data.atomsStored ?? data.atomsProcessed ?? 0;
      setNotification({
        type: "success",
        message: `Synced ${count} items from ${provider.replace("_", " ")}`,
      });

      fetchIntegrations();
    } catch (error) {
      console.error("Error syncing:", error);
      setNotification({
        type: "error",
        message: error instanceof Error ? error.message : "Sync failed",
      });
    }
  }

  function getStatus(provider: string): "connected" | "disconnected" | "error" | "loading" {
    if (loading) return "loading";
    const status = integrations[provider];
    if (!status) return "disconnected";
    if (status.integration?.status === "error") return "error";
    return status.connected ? "connected" : "disconnected";
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Connected Apps</h2>
        <p className="text-sm text-muted-foreground">
          Connect your apps to sync data and enable AI-powered insights
        </p>
      </div>

      {notification && (
        <div
          className={`rounded-lg p-3 text-sm ${
            notification.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {notification.message}
        </div>
      )}

      <div className="space-y-3">
        {INTEGRATIONS_CONFIG.map((config) => {
          const status = integrations[config.provider];
          const isDisabled = config.disabled;

          if (isDisabled) {
            return (
              <div key={config.provider} className="opacity-50">
                <IntegrationCard
                  provider={config.provider}
                  displayName={config.displayName}
                  description={config.description + " (Coming soon)"}
                  icon={config.icon}
                  status="disconnected"
                  onConnect={() => {}}
                  onDisconnect={() => {}}
                />
              </div>
            );
          }

          return (
            <IntegrationCard
              key={config.provider}
              provider={config.provider}
              displayName={config.displayName}
              description={config.description}
              icon={config.icon}
              status={getStatus(config.provider)}
              externalEmail={status?.integration?.externalEmail}
              lastSyncAt={status?.integration?.lastSyncAt}
              lastSyncStatus={status?.integration?.lastSyncStatus}
              onConnect={() => handleConnect(config.provider)}
              onDisconnect={() => handleDisconnect(config.provider)}
              onSync={status?.connected ? () => handleSync(config.provider) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
