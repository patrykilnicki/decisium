"use client";

import { SupabaseRealtimeProvider } from "@/lib/realtime";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <SupabaseRealtimeProvider>
      <SidebarProvider
        defaultOpen={false}
        open={false}
        onOpenChange={() => {}}
        style={
          {
            "--sidebar-width-icon": "4rem",
          } as React.CSSProperties
        }
      >
        <AppSidebar />
        <SidebarInset>
          <main className="flex-1 overflow-hidden flex flex-col min-h-0">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </SupabaseRealtimeProvider>
  );
}
