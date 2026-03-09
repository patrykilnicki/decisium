"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

export interface IntegrationListItem {
  id: string;
  displayName: string;
  icon: React.ReactNode;
  status: "connected" | "disconnected" | "error" | "loading";
  disabled?: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

interface IntegrationListProps {
  items: IntegrationListItem[];
  className?: string;
}

export function IntegrationList({ items, className }: IntegrationListProps) {
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-xl border border-border bg-background shadow-sm",
        className,
      )}
    >
      {items.map((item, index) => (
        <IntegrationListRow
          key={item.id}
          item={item}
          isLast={index === items.length - 1}
        />
      ))}
    </div>
  );
}

interface IntegrationListRowProps {
  item: IntegrationListItem;
  isLast: boolean;
}

function IntegrationListRow({ item, isLast }: IntegrationListRowProps) {
  const [isLoading, setIsLoading] = useState(false);
  const isConnected = item.status === "connected";
  const isError = item.status === "error";
  const showConnect =
    !isConnected && item.status !== "loading" && !item.disabled;

  async function handleConnect() {
    setIsLoading(true);
    try {
      await item.onConnect();
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDisconnect() {
    setIsLoading(true);
    try {
      await item.onDisconnect();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-4 px-6 h-18",
        item.disabled && "bg-muted/50",
        !isLast && "border-b border-border",
      )}
    >
      <div
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center [&_svg]:size-6",
          item.disabled && "grayscale opacity-70",
        )}
      >
        {item.icon}
      </div>
      <p
        className={cn(
          "min-w-0 flex-1 text-[15px] font-medium leading-6",
          item.disabled ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {item.displayName}
      </p>
      <div className="shrink-0">
        {item.disabled ? (
          <span className="rounded-xl border border-input bg-muted/50 px-3 py-1.5 text-[13px] font-medium tracking-[-0.13px] text-muted-foreground">
            Coming soon
          </span>
        ) : isConnected ? (
          <>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-xl border-input bg-background px-3 py-1.5 text-[13px] font-medium tracking-[-0.13px] shadow-xs"
                  disabled={isLoading}
                >
                  {isLoading ? "Disconnecting…" : "Disconnect"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Disconnect {item.displayName}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This will revoke access to your {item.displayName} data. You
                    can reconnect at any time.
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
        ) : showConnect ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-xl border-input bg-background px-3 py-1.5 text-[13px] font-medium tracking-[-0.13px] shadow-xs"
            onClick={handleConnect}
            disabled={isLoading || item.status === "loading"}
          >
            {isLoading || item.status === "loading" ? "Connecting…" : "Connect"}
          </Button>
        ) : isError ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-xl border-input bg-background px-3 py-1.5 text-[13px] font-medium tracking-[-0.13px] shadow-xs"
            onClick={handleConnect}
            disabled={isLoading}
          >
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}
