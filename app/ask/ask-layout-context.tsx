"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { AskThread } from "@/packages/agents/schemas/ask.schema";

interface AskLayoutContextValue {
  threads: AskThread[];
  threadsLoading: boolean;
  loadThreads: () => Promise<void>;
}

const AskLayoutContext = createContext<AskLayoutContextValue | null>(null);

export function useAskLayout() {
  const ctx = useContext(AskLayoutContext);
  if (!ctx) {
    throw new Error("useAskLayout must be used within AskLayoutProvider");
  }
  return ctx;
}

interface AskLayoutProviderProps {
  children: React.ReactNode;
}

export function AskLayoutProvider({ children }: AskLayoutProviderProps) {
  const [threads, setThreads] = useState<AskThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);

  const loadThreads = useCallback(async () => {
    try {
      const response = await fetch("/api/ask/threads");
      if (response.ok) {
        const data = await response.json();
        setThreads(data);
      }
    } catch (err) {
      console.error("Failed to load threads:", err);
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  useEffect(() => {
    const schedule = queueMicrotask || ((fn: () => void) => setTimeout(fn, 0));
    schedule(() => {
      loadThreads();
    });
  }, [loadThreads]);

  return (
    <AskLayoutContext.Provider value={{ threads, threadsLoading, loadThreads }}>
      {children}
    </AskLayoutContext.Provider>
  );
}
