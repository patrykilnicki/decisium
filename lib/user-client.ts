import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { CurrentUser } from "@/lib/user";

/**
 * Get the current authenticated user (client-side)
 * Use this in Client Components
 * @returns CurrentUser object with name, email, and photo, or null if not authenticated
 */
export async function getCurrentUserClient(): Promise<CurrentUser | null> {
  const supabase = createBrowserClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return {
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    email: user.email ?? null,
    photo:
      user.user_metadata?.avatar_url ??
      user.user_metadata?.picture ??
      null,
  };
}
