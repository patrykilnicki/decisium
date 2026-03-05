import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueTask } from "@/lib/tasks/task-repository";
import { triggerTask } from "@/lib/tasks/task-processor";
import type { Json } from "@/types/supabase";

/** Providers that support sync-after-onboarding (create a task to sync events). */
export const SYNC_AFTER_ONBOARDING_PROVIDERS = ["google_calendar"] as const;

export interface DispatchIntegrationSyncTaskOptions {
  userId: string;
  integrationId: string;
  provider: string;
}

/**
 * Enqueue an integration.sync task. Used after onboarding when user connected
 * apps—the task will sync events (e.g. Google Calendar) before showing the dashboard.
 */
export async function dispatchIntegrationSyncTask(
  options: DispatchIntegrationSyncTaskOptions,
): Promise<string> {
  const client = createAdminClient();
  const task = await enqueueTask(client, {
    user_id: options.userId,
    session_id: `system:integration_sync:${options.userId}`,
    task_type: "integration.sync",
    status: "pending",
    input: {
      state: {
        userId: options.userId,
        integrationId: options.integrationId,
        provider: options.provider,
      },
    } as Json,
  });

  triggerTask(task.id);
  return task.id;
}
