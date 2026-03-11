"use client";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { AskSidebar } from "@/app/ask/components/ask-sidebar";
import { AskLayoutProvider } from "@/app/ask/ask-layout-context";

export default function AskSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <AppLayout>
        <AskLayoutProvider>
          <div className="relative flex h-full min-h-0 flex-1 flex-col items-center overflow-hidden bg-background bg-[url('/bg.svg')] bg-no-repeat bg-left-top bg-[length:auto_50vh] dark:bg-[url('/bg-dark.svg')]">
            <div className="flex h-full min-h-0 w-full overflow-hidden">
              <AskSidebar />
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {children}
              </div>
            </div>
          </div>
        </AskLayoutProvider>
      </AppLayout>
    </ProtectedRoute>
  );
}
