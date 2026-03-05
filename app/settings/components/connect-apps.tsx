"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CentralIcon } from "@/components/ui/central-icon";
import { IntegrationCard } from "./integration-card";
import { SyncModal } from "./sync-modal";

export interface Integration {
  id: string;
  provider: string;
  status: string;
  externalEmail?: string;
  connectedAt?: string;
  lastSyncAt?: string;
  lastSyncStatus?: "success" | "error" | "partial";
}

export interface IntegrationConfigItem {
  provider: string;
  displayName: string;
  description: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

export const INTEGRATIONS_CONFIG: IntegrationConfigItem[] = [
  {
    provider: "google_calendar",
    displayName: "Google Calendar",
    description: "Sync calendar events and meeting schedules",
    icon: <CentralIcon name="IconCalendar1" size={24} />,
  },
  {
    provider: "gmail",
    displayName: "Gmail",
    description: "Sync emails and communication history",
    icon: <CentralIcon name="IconEmail1" size={24} />,
  },
  {
    provider: "notion",
    displayName: "Notion",
    description: "Sync pages, databases, and notes",
    icon: <CentralIcon name="IconFileText" size={24} />,
    disabled: true,
  },
  {
    provider: "linear",
    displayName: "Linear",
    description: "Sync issues, projects, and tasks",
    icon: <CentralIcon name="IconChecklist" size={24} />,
    disabled: true,
  },
];

export interface ConnectAppsProps {
  /** Redirect path after OAuth (e.g. /onboarding or /settings). Default /settings. */
  returnTo?: string;
  /** Only show these providers. If not set, show all non-disabled from config. */
  providersFilter?: string[];
  /** Callback when sync modal closes (e.g. refresh parent). */
  onSyncModalClose?: () => void;
  /** Show inline notification for errors. Default true. */
  showNotification?: boolean;
}

export function ConnectApps({
  returnTo = "/settings",
  providersFilter,
  onSyncModalClose,
  showNotification = true,
}: ConnectAppsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [integrations, setIntegrations] = useState<
    Record<
      string,
      { connected: boolean; provider: string; integration?: Integration }
    >
  >({});
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncProvider, setSyncProvider] = useState("");
  const [syncIntegrationId, setSyncIntegrationId] = useState("");

  const fetchIntegrations = useCallback(async () => {
    try {
      const response = await fetch("/api/integrations");
      if (!response.ok) throw new Error("Failed to fetch integrations");
      const data = await response.json();
      const statusMap: Record<
        string,
        { connected: boolean; provider: string; integration?: Integration }
      > = {};
      const configs = providersFilter
        ? INTEGRATIONS_CONFIG.filter((c) =>
            providersFilter.includes(c.provider),
          )
        : INTEGRATIONS_CONFIG.filter((c) => !c.disabled);
      configs.forEach((config) => {
        statusMap[config.provider] = {
          connected: false,
          provider: config.provider,
        };
      });
      (data.integrations as Integration[]).forEach(
        (integration: Integration) => {
          if (statusMap[integration.provider] !== undefined) {
            statusMap[integration.provider] = {
              connected: integration.status === "active",
              provider: integration.provider,
              integration,
            };
          }
        },
      );
      setIntegrations(statusMap);
    } catch (error) {
      console.error("Error fetching integrations:", error);
    } finally {
      setLoading(false);
    }
  }, [providersFilter]);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const integrationId = searchParams.get("integration_id");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    if (connected && integrationId) {
      setSyncProvider(connected);
      setSyncIntegrationId(integrationId);
      setSyncModalOpen(true);
      router.replace(returnTo);
    } else if (error && showNotification) {
      const messages: Record<string, string> = {
        connection_not_found:
          "Connection not found. Please try connecting again.",
        composio_not_configured: "Composio is not configured. Contact support.",
        callback_failed: "Connection callback failed. Please try again.",
      };
      setNotification({
        type: "error",
        message:
          errorDescription || messages[error] || `Connection failed: ${error}`,
      });
      router.replace(returnTo);
    }
  }, [searchParams, router, returnTo, showNotification]);

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
        body: JSON.stringify({ provider, returnTo }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to start connection");
      }
      const data = await response.json();
      if (data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      }
    } catch (error) {
      if (showNotification) {
        setNotification({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to connect",
        });
      }
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
      if (showNotification) {
        setNotification({
          type: "success",
          message: `Disconnected from ${provider.replace("_", " ")}`,
        });
      }
      fetchIntegrations();
    } catch (error) {
      if (showNotification) {
        setNotification({
          type: "error",
          message:
            error instanceof Error ? error.message : "Failed to disconnect",
        });
      }
    }
  }

  function handleSyncModalClose() {
    setSyncModalOpen(false);
    fetchIntegrations();
    onSyncModalClose?.();
  }

  function getStatus(
    provider: string,
  ): "connected" | "disconnected" | "error" | "loading" {
    if (loading) return "loading";
    const status = integrations[provider];
    if (!status) return "disconnected";
    if (status.integration?.status === "error") return "error";
    return status.connected ? "connected" : "disconnected";
  }

  const configs = providersFilter
    ? INTEGRATIONS_CONFIG.filter((c) => providersFilter.includes(c.provider))
    : INTEGRATIONS_CONFIG;

  return (
    <>
      {showNotification && notification && (
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
        {configs.map((config) => {
          const status = integrations[config.provider];
          const isDisabled = config.disabled ?? false;
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
            />
          );
        })}
      </div>
      <SyncModal
        open={syncModalOpen}
        onClose={handleSyncModalClose}
        provider={syncProvider}
        integrationId={syncIntegrationId}
      />
    </>
  );
}
