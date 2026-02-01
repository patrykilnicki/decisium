"use client";

import { Suspense } from "react";
import { useRouter } from "next/navigation";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { IntegrationsSection } from "@/components/settings";
import { createClient } from "@/lib/supabase/client";

function SettingsContent() {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-col h-full">
      <header className="border-b p-4">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account and preferences
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl space-y-8">
          {/* Integrations Section */}
          <IntegrationsSection />

          <Separator />

          {/* Account Section */}
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Account</h2>
              <p className="text-sm text-muted-foreground">
                Manage your account settings
              </p>
            </div>
            <Button variant="outline" onClick={handleSignOut}>
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <ProtectedRoute>
      <AppLayout>
        <Suspense fallback={<div className="p-4">Loading settings...</div>}>
          <SettingsContent />
        </Suspense>
      </AppLayout>
    </ProtectedRoute>
  );
}
