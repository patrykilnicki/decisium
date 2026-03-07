"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const REALTIME_CHANNEL = "realtime:db-changes";

interface SupabaseRealtimeContextValue {
  calendarVersion: number;
  tasksVersion: number;
  isConnected: boolean;
}

const SupabaseRealtimeContext =
  createContext<SupabaseRealtimeContextValue | null>(null);

export function SupabaseRealtimeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const [calendarVersion, setCalendarVersion] = useState(0);
  const [tasksVersion, setTasksVersion] = useState(0);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    function handleAuthChange() {
      supabase.auth.getUser().then(({ data: { user } }) => {
        setUserId(user?.id ?? null);
      });
    }

    handleAuthChange();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(handleAuthChange);
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) {
      queueMicrotask(() => {
        setCalendarVersion(0);
        setTasksVersion(0);
        setIsConnected(false);
      });
      return;
    }

    const supabase = createClient();
    const channel = supabase
      .channel(REALTIME_CHANNEL)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "activity_atoms",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          setCalendarVersion((v) => v + 1);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "todo_items",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          setTasksVersion((v) => v + 1);
        },
      )
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const value = useMemo<SupabaseRealtimeContextValue>(
    () => ({
      calendarVersion,
      tasksVersion,
      isConnected,
    }),
    [calendarVersion, tasksVersion, isConnected],
  );

  return (
    <SupabaseRealtimeContext.Provider value={value}>
      {children}
    </SupabaseRealtimeContext.Provider>
  );
}

export function useSupabaseRealtime(): SupabaseRealtimeContextValue {
  const ctx = useContext(SupabaseRealtimeContext);
  if (ctx === null) {
    return {
      calendarVersion: 0,
      tasksVersion: 0,
      isConnected: false,
    };
  }
  return ctx;
}
