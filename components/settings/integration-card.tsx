"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface IntegrationCardProps {
  provider: string;
  displayName: string;
  description: string;
  icon: React.ReactNode;
  status: "connected" | "disconnected" | "error" | "loading";
  externalEmail?: string;
  lastSyncAt?: string;
  lastSyncStatus?: "success" | "error" | "partial";
  onConnect: () => void;
  onDisconnect: () => void;
  onSync?: () => void;
}

export function IntegrationCard({
  displayName,
  description,
  icon,
  status,
  externalEmail,
  lastSyncAt,
  lastSyncStatus,
  onConnect,
  onDisconnect,
  onSync,
}: IntegrationCardProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  async function handleConnect() {
    setIsLoading(true);
    try {
      await onConnect();
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDisconnect() {
    setIsLoading(true);
    try {
      await onDisconnect();
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSync() {
    if (!onSync) return;
    setIsSyncing(true);
    try {
      await onSync();
    } finally {
      setIsSyncing(false);
    }
  }

  const isConnected = status === "connected";
  const isError = status === "error";

  return (
    <Card className="p-4">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
          {icon}
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{displayName}</h3>
            {isConnected && (
              <Badge variant="secondary" className="bg-green-100 text-green-800">
                Connected
              </Badge>
            )}
            {isError && (
              <Badge variant="destructive">
                Error
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
          {isConnected && externalEmail && (
            <p className="text-sm text-muted-foreground">
              Connected as: {externalEmail}
            </p>
          )}
          {isConnected && lastSyncAt && (
            <p className="text-xs text-muted-foreground">
              Last synced: {new Date(lastSyncAt).toLocaleString()}
              {lastSyncStatus && lastSyncStatus !== "success" && (
                <span className="text-yellow-600"> ({lastSyncStatus})</span>
              )}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {isConnected ? (
            <>
              {onSync && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSync}
                  disabled={isSyncing}
                >
                  {isSyncing ? "Syncing..." : "Sync Now"}
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={isLoading}>
                    Disconnect
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect {displayName}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will revoke access to your {displayName} data. You can
                      reconnect at any time.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDisconnect}>
                      Disconnect
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : (
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={isLoading || status === "loading"}
            >
              {isLoading || status === "loading" ? "Connecting..." : "Connect"}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
