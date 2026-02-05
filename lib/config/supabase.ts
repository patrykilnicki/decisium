export const supabaseConfig = {
  url: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY, // For admin operations
};

const hasAnon = Boolean(supabaseConfig.anonKey);
const hasServiceRole = Boolean(supabaseConfig.serviceRoleKey);

if (!supabaseConfig.url || (!hasAnon && !hasServiceRole)) {
  throw new Error(
    "Missing Supabase environment variables. Please set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and either NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY",
  );
}
