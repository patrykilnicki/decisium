import {
  authUserToCurrentUser,
  type CurrentUser,
  type CurrentUserUpdate,
} from "@/lib/user";
import { createClient } from "@/lib/supabase/client";

/**
 * Get the current authenticated user (client-side).
 * Use in Client Components.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return authUserToCurrentUser(user);
}

/**
 * Update the current user's profile (name and/or photo).
 * Preserves existing user_metadata and only updates provided fields.
 */
export async function updateCurrentUser(
  updates: CurrentUserUpdate,
): Promise<{ data: CurrentUser | null; error: Error | null }> {
  const supabase = createClient();
  const {
    data: { user: existingUser },
    error: fetchError,
  } = await supabase.auth.getUser();

  if (fetchError || !existingUser) {
    return {
      data: null,
      error: fetchError ?? new Error("Not authenticated"),
    };
  }

  const data: Record<string, unknown> = { ...existingUser.user_metadata };
  if (updates.name !== undefined) {
    data.full_name = updates.name;
    data.name = updates.name;
  }
  if (updates.photo !== undefined) {
    data.avatar_url = updates.photo;
    data.picture = updates.photo;
  }

  const { data: updated, error } = await supabase.auth.updateUser({ data });

  if (error) return { data: null, error };
  return {
    data: updated.user ? authUserToCurrentUser(updated.user) : null,
    error: null,
  };
}

/**
 * Delete the current user's account (server deletes via service role), then sign out.
 * Call from client only.
 */
export async function deleteCurrentUser(): Promise<{ error: Error | null }> {
  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: authError ?? new Error("Not authenticated") };
  }

  const res = await fetch("/api/account", { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return {
      error: new Error(
        (body as { error?: string })?.error ?? `Delete failed: ${res.status}`,
      ),
    };
  }

  await supabase.auth.signOut();
  return { error: null };
}

/** @deprecated Use getCurrentUser from @/lib/user-client */
export const getCurrentUserClient = getCurrentUser;

export type { CurrentUser, CurrentUserUpdate } from "@/lib/user";
