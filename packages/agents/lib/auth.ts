import { createClient } from "@/lib/supabase/server";
import { getCurrentAuthUser } from "@/lib/user-server";
import * as db from "@/lib/supabase/db";
import { getTodayInTimezone } from "@/lib/datetime/user-timezone";

export interface UserContext {
  userId: string;
  currentDate: string;
  userEmail?: string;
  preferredModel?: string;
  timezone?: string;
}

/**
 * Get the authenticated user (uses central getCurrentAuthUser).
 * @throws {Error} If user is not authenticated
 */
export async function getAuthenticatedUser() {
  const user = await getCurrentAuthUser();
  if (!user) {
    throw new Error("Unauthorized: User not authenticated");
  }
  return user;
}

/**
 * Require authentication - throws if user is not authenticated
 * @returns The authenticated user
 * @throws {Error} If user is not authenticated
 */
export async function requireAuth() {
  return getAuthenticatedUser();
}

/**
 * Get user context with userId and current date (uses central getCurrentAuthUser).
 * This is the primary function for getting auth context in agents
 */
export async function getUserContext(): Promise<UserContext> {
  const supabase = await createClient();
  const user = await getAuthenticatedUser();
  const { data: profile } = await db.selectOne(
    supabase,
    "users",
    { id: user.id },
    {
      columns: "preferred_llm_model, timezone",
    },
  );
  const timezone =
    (profile as { timezone?: string | null } | null)?.timezone ?? undefined;
  const currentDate = getTodayInTimezone(timezone ?? "UTC", new Date());

  return {
    userId: user.id,
    currentDate,
    userEmail: user.email,
    preferredModel:
      (profile as { preferred_llm_model?: string } | null)
        ?.preferred_llm_model ?? undefined,
    timezone: timezone ?? undefined,
  };
}

/**
 * Get user context with a specific date (for historical queries).
 * Uses central getCurrentAuthUser.
 */
export async function getUserContextWithDate(
  date: string,
): Promise<UserContext> {
  const supabase = await createClient();
  const user = await getAuthenticatedUser();
  const { data: profile } = await db.selectOne(
    supabase,
    "users",
    { id: user.id },
    {
      columns: "preferred_llm_model",
    },
  );

  return {
    userId: user.id,
    currentDate: date,
    userEmail: user.email,
    preferredModel:
      (profile as { preferred_llm_model?: string } | null)
        ?.preferred_llm_model ?? undefined,
  };
}
