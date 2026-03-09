"use client";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { SettingsNav } from "@/app/settings/components/settings-nav";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <AppLayout>
        <div
          className="relative flex min-h-full flex-1 flex-col items-center bg-background"
          style={{
            backgroundImage: "url(/bg.svg)",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "top left",
            backgroundSize: "auto 50vh",
          }}
        >
          <div className="flex h-full w-full min-h-0">
            <SettingsNav />
            <div className="flex min-h-0 flex-1 flex-col w-full">
              <div className="flex-1 overflow-y-auto min-h-0 py-10">
                <div className="mx-auto max-w-3xl w-full">{children}</div>
              </div>
            </div>
          </div>
        </div>
      </AppLayout>
    </ProtectedRoute>
  );
}
