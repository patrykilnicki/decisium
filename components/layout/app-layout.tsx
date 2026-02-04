"use client";

import { Nav } from "@/components/layout/nav";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex h-screen">
      <Nav />
      <main className="flex-1 overflow-hidden flex flex-col min-h-0">{children}</main>
    </div>
  );
}
