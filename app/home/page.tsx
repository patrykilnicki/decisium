"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { HomeContent } from "@/app/home/components/home-content";
import { createClient } from "@/lib/supabase/client";
import { CentralIcon } from "@/components/ui/central-icon";

const POLL_INTERVAL_MS = 1500;

function HomePageContent() {
  const searchParams = useSearchParams();
  const isPreparing = searchParams.get("preparing") === "1";
  const [userName, setUserName] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [syncReady, setSyncReady] = useState(!isPreparing);

  useEffect(() => {
    async function fetchUser() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const name =
          user.user_metadata?.full_name ??
          user.user_metadata?.name ??
          user.email?.split("@")[0];
        setUserName(name ?? "there");
        setUserId(user.id);
      } else {
        setUserName("there");
        setUserId(null);
      }
    }
    fetchUser();
  }, []);

  useEffect(() => {
    if (!isPreparing) return;
    let cancelled = false;
    async function pollPendingSync() {
      while (!cancelled) {
        try {
          const res = await fetch("/api/tasks/pending-sync-status");
          if (!res.ok) break;
          const data = await res.json();
          if (!data.hasPending) {
            setSyncReady(true);
            // Remove ?preparing=1 from URL without full reload
            window.history.replaceState({}, "", window.location.pathname);
            break;
          }
        } catch {
          // Retry on error
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    }
    pollPendingSync();
    return () => {
      cancelled = true;
    };
  }, [isPreparing]);

  const showLoader = isPreparing && !syncReady;

  return (
    <ProtectedRoute>
      <AppLayout>
        {showLoader ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
            <CentralIcon name="IconLoader" size={24} className="animate-spin" />
            <p className="text-sm font-semibold">Configuring your dashboard</p>
            <p className="text-xs text-muted-foreground">
              Syncing your calendar and data...
            </p>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden overscroll-y-auto scroll-smooth">
            <HomeContent userName={userName} userId={userId} />
          </div>
        )}
      </AppLayout>
    </ProtectedRoute>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <ProtectedRoute>
          <AppLayout>
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
              <CentralIcon
                name="IconLoader"
                size={24}
                className="animate-spin"
              />
            </div>
          </AppLayout>
        </ProtectedRoute>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}
