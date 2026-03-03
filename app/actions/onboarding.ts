"use server";

import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/supabase/db";
import { redirect } from "next/navigation";

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

  return { success: true };
}
