import { createClient as createServerClient } from "@/lib/supabase/server";

export interface CurrentUser {
  name: string | null;
  email: string | null;
  photo: string | null;
}

/**
 * Get the current authenticated user (server-side)
 * Use this in Server Components, Server Actions, API Routes, etc.
 * @returns CurrentUser object with name, email, and photo, or null if not authenticated
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createServerClient();
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
      user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null,
  };
}
