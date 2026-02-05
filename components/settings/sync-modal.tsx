"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

interface SyncModalProps {
  open: boolean;
  onClose: () => void;
  provider: string;
  integrationId: string;
}

type SyncStatus = "syncing" | "success" | "error";

export function SyncModal({
  open,
  onClose,
  provider,
  integrationId,
}: SyncModalProps) {
  const [status, setStatus] = useState<SyncStatus>("syncing");
  const [eventCount, setEventCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const syncStartedRef = useRef(false);

  const displayName = provider.replace("_", " ");

  const runSync = useCallback(async () => {
    if (!integrationId || !provider) return;

    setStatus("syncing");
    setErrorMessage("");

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
      setEventCount(count);
      setStatus("success");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Sync failed");
      setStatus("error");
    }
  }, [integrationId, provider]);

  // Start sync once when modal opens (ref prevents duplicate calls from Strict Mode or re-renders)
  useEffect(() => {
    if (!open || !integrationId || !provider) return;
    if (syncStartedRef.current) return;
    syncStartedRef.current = true;
    runSync();
  }, [open, integrationId, provider, runSync]);

  // Auto-close on success after 2 seconds
  useEffect(() => {
    if (status === "success") {
      const timer = setTimeout(() => {
        onClose();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [status, onClose]);

  // Reset state and ref when modal closes (allows sync to run again if modal reopens)
  useEffect(() => {
    if (!open) {
      syncStartedRef.current = false;
      setStatus("syncing");
      setEventCount(0);
      setErrorMessage("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {status === "syncing" && `Syncing ${displayName}`}
            {status === "success" && "Sync Complete"}
            {status === "error" && "Sync Failed"}
          </DialogTitle>
          <DialogDescription>
            {status === "syncing" && "Downloading your events..."}
            {status === "success" &&
              `Successfully synced ${eventCount} events from ${displayName}.`}
            {status === "error" && errorMessage}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center py-8">
          {status === "syncing" && (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                This may take a moment...
              </p>
            </div>
          )}
          {status === "success" && (
            <div className="flex flex-col items-center gap-4">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="text-sm text-muted-foreground">
                Closing automatically...
              </p>
            </div>
          )}
          {status === "error" && (
            <div className="flex flex-col items-center gap-4">
              <XCircle className="h-12 w-12 text-red-500" />
              <p className="text-sm text-muted-foreground">
                Please try again later.
              </p>
            </div>
          )}
        </div>

        {status === "error" && (
          <DialogFooter>
            <DialogClose>Close</DialogClose>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
