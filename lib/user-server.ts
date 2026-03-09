import type { User } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { authUserToCurrentUser, type CurrentUser } from "@/lib/user";

/**
 * Get the raw Supabase Auth user (server-side).
 * Use when you need user.id or full auth user (e.g. agents, API routes).
 */
export async function getCurrentAuthUser(): Promise<User | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return user;
}

/**
 * Get the current authenticated user as CurrentUser (server-side).
 * Use in Server Components, Server Actions, API Routes.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const user = await getCurrentAuthUser();
  return user ? authUserToCurrentUser(user) : null;
}
