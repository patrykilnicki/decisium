import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/supabase/db";

export interface UserContext {
  userId: string;
  currentDate: string;
  userEmail?: string;
  preferredModel?: string;
}

/**
 * Get the authenticated user from Supabase
 * @throws {Error} If user is not authenticated
 */
export async function getAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
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
 * Get user context with userId and current date
 * This is the primary function for getting auth context in agents
 */
export async function getUserContext(): Promise<UserContext> {
  const supabase = await createClient();
  const user = await getAuthenticatedUser();
  const currentDate = new Date().toISOString().split("T")[0];
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
    currentDate,
    userEmail: user.email,
    preferredModel:
      (profile as { preferred_llm_model?: string } | null)
        ?.preferred_llm_model ?? undefined,
  };
}

/**
 * Get user context with a specific date (for historical queries)
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
