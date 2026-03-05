"use server";

import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/supabase/db";
import { redirect } from "next/navigation";
import {
  SYNC_AFTER_ONBOARDING_PROVIDERS,
  dispatchIntegrationSyncTask,
} from "@/lib/tasks/integration-sync-dispatcher";

export async function completeOnboarding() {
  const supabase = await createClient();
  const { user, error: authError } = await db.getAuthUser(supabase);

  if (authError || !user) {
    redirect("/auth");
  }

  const { error } = await db.update(
    supabase,
    "users",
    { id: user.id },
    {
      onboarding_completed: true,
      onboarding_completed_at: new Date().toISOString(),
    },
  );

  if (error) {
    console.error("Failed to complete onboarding:", error);
    throw new Error("Failed to complete onboarding");
  }

  const syncTaskIds: string[] = [];
  const { data: integrations } = await db.selectMany(
    supabase,
    "integrations",
    {
      user_id: user.id,
      status: "active",
      provider: [...SYNC_AFTER_ONBOARDING_PROVIDERS],
    },
    { columns: "id, provider" },
  );

  for (const integration of integrations ?? []) {
    const row = integration as { id: string; provider: string };
    if (
      (SYNC_AFTER_ONBOARDING_PROVIDERS as readonly string[]).includes(
        row.provider,
      )
    ) {
      try {
        const taskId = await dispatchIntegrationSyncTask({
          userId: user.id,
          integrationId: row.id,
          provider: row.provider,
        });
        syncTaskIds.push(taskId);
      } catch (err) {
        console.error(
          `Failed to dispatch sync for integration ${row.id}:`,
          err,
        );
      }
    }
  }

  return {
    success: true,
    hasSyncTasks: syncTaskIds.length > 0,
    syncTaskIds,
  };
}
