"use client";

import { useEffect, useState } from "react";
import { AskThread } from "@/packages/agents/schemas/ask.schema";
import { ThreadList } from "@/components/ask/thread-list";
import { NewThreadButton } from "@/components/ask/new-thread-button";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";

export default function AskPage() {
  const [threads, setThreads] = useState<AskThread[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadThreads();
  }, []);

  async function loadThreads() {
    try {
      setLoading(true);
      const response = await fetch("/api/ask/threads");
      if (response.ok) {
        const data = await response.json();
        setThreads(data);
      }
    } catch (error) {
      console.error("Failed to load threads:", error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ProtectedRoute>
      <AppLayout>
        <div className="flex flex-col h-full">
          <header className="border-b p-4">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold">Ask AI</h1>
              <NewThreadButton />
            </div>
          </header>
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-muted-foreground">Loading...</div>
              </div>
            ) : (
              <ThreadList threads={threads} />
            )}
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
