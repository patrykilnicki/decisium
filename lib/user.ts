import type { User } from "@supabase/supabase-js";

export interface CurrentUser {
  name: string | null;
  email: string | null;
  photo: string | null;
}

/** Metadata keys used by Supabase Auth (full_name, avatar_url) for profile updates */
export interface CurrentUserUpdate {
  name?: string | null;
  photo?: string | null;
}

/**
 * Single source of truth: map Supabase Auth user to CurrentUser.
 * Used by both server and client getters.
 */
export function authUserToCurrentUser(user: User): CurrentUser {
  return {
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    email: user.email ?? null,
    photo:
      user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null,
  };
}
