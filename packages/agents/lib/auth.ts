import { createClient } from "@/lib/supabase/server";

export interface UserContext {
  userId: string;
  currentDate: string;
  userEmail?: string;
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
  const user = await getAuthenticatedUser();
  const currentDate = new Date().toISOString().split("T")[0];

  return {
    userId: user.id,
    currentDate,
    userEmail: user.email,
  };
}

/**
 * Get user context with a specific date (for historical queries)
 */
export async function getUserContextWithDate(
  date: string,
): Promise<UserContext> {
  const user = await getAuthenticatedUser();

  return {
    userId: user.id,
    currentDate: date,
    userEmail: user.email,
  };
}
