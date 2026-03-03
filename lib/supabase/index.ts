/**
 * Supabase: use server/client/admin for the right context, then use db.* for CRUD.
 *
 * - Server (RSC, Route Handlers, Server Actions): import { createClient } from "@/lib/supabase/server"
 * - Browser (Client Components): import { createClient } from "@/lib/supabase/client"
 * - Admin (webhooks, cron, bypass RLS): import { createAdminClient } from "@/lib/supabase/admin"
 *
 * Then use db.selectOne, db.selectMany, db.insertOne, db.insertMany, db.update, db.upsert, db.remove
 * so all table operations go through one place.
 */
export { createAdminClient } from "./admin";
export * from "./db";
