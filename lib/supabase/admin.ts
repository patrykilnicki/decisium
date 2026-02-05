import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/config/supabase";
import type { Database } from "@/types/supabase";

export function createAdminClient() {
  if (!supabaseConfig.serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for admin client.");
  }

  return createClient<Database>(supabaseConfig.url, supabaseConfig.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
