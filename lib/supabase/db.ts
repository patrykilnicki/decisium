/**
 * Centralized Supabase CRUD – jeden moduł zamiast powielania .from().select/insert/update/upsert/delete.
 *
 * Użycie:
 *   - Server: const supabase = await createClient();  // from @/lib/supabase/server
 *   - Browser: const supabase = createClient();       // from @/lib/supabase/client
 *   - Admin:  const supabase = createAdminClient();   // from @/lib/supabase/admin
 *
 * Następnie: db.selectOne(supabase, "users", { id }), db.update(supabase, "users", { id }, { ... }),
 *            db.insertOne(supabase, "tasks", payload), db.upsert(..., { onConflict: "..." }), db.remove(...).
 * Auth: db.getAuthUser(supabase) zamiast supabase.auth.getUser().
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

type Tables = Database["public"]["Tables"];
export type TableName = keyof Tables;

/** Row type for a table (result of select) */
export type Row<T extends TableName> = Tables[T] extends { Row: infer R }
  ? R
  : never;

/** Insert payload for a table */
export type InsertDto<T extends TableName> = Tables[T] extends {
  Insert: infer I;
}
  ? I
  : never;

/** Update payload for a table (partial) */
export type UpdateDto<T extends TableName> = Tables[T] extends {
  Update: infer U;
}
  ? U
  : never;

/** Filters as key-value pairs; each key gets .eq(key, value) */
export type Filters = Record<
  string,
  string | number | boolean | null | string[]
>;

export interface SelectOptions {
  columns?: string;
  order?: { column: string; ascending?: boolean };
  limit?: number;
  offset?: number;
}

export interface UpsertOptions {
  onConflict?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Apply .eq() / .in() from filters to a Supabase query builder.
 */
function applyFilters(q: any, filters: Filters): any {
  let chain = q;
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      chain = chain.in(key, value);
    } else {
      chain = chain.eq(key, value);
    }
  }
  return chain;
}

/**
 * Select a single row by filters. Returns null if not found or error.
 */
export async function selectOne<T extends TableName>(
  client: SupabaseClient<Database>,
  table: T,
  filters: Filters,
  options?: { columns?: string },
): Promise<{ data: Row<T> | null; error: Error | null }> {
  const query = client.from(table).select(options?.columns ?? "*");
  const { data, error } = await applyFilters(query, filters).maybeSingle();
  return {
    data: data as Row<T> | null,
    error: error ? new Error(error.message) : null,
  };
}

/**
 * Select multiple rows with optional filters, ordering, and limit.
 */
export async function selectMany<T extends TableName>(
  client: SupabaseClient<Database>,
  table: T,
  filters: Filters = {},
  options?: SelectOptions,
): Promise<{ data: Row<T>[]; error: Error | null }> {
  let query: any = client.from(table).select(options?.columns ?? "*");
  query = applyFilters(query, filters);
  if (options?.order) {
    query = query.order(options.order.column, {
      ascending: options.order.ascending ?? true,
    });
  }
  if (options?.limit != null) query = query.limit(options.limit);
  if (options?.offset != null)
    query = query.range(
      options.offset,
      options.offset + (options.limit ?? 10) - 1,
    );
  const { data, error } = await query;
  return {
    data: (data ?? []) as Row<T>[],
    error: error ? new Error(error.message) : null,
  };
}

/**
 * Insert one row. Returns the inserted row (with select().single()).
 */
export async function insertOne<T extends TableName>(
  client: SupabaseClient<Database>,
  table: T,
  payload: InsertDto<T>,
): Promise<{ data: Row<T> | null; error: Error | null }> {
  const { data, error } = await client
    .from(table)
    .insert(payload as any)
    .select()
    .single();
  return {
    data: data as Row<T> | null,
    error: error ? new Error(error.message) : null,
  };
}

/**
 * Insert multiple rows. Returns inserted rows.
 */
export async function insertMany<T extends TableName>(
  client: SupabaseClient<Database>,
  table: T,
  payloads: InsertDto<T>[],
): Promise<{ data: Row<T>[]; error: Error | null }> {
  if (payloads.length === 0) return { data: [], error: null };
  const { data, error } = await client
    .from(table)
    .insert(payloads as any)
    .select();
  return {
    data: (data ?? []) as Row<T>[],
    error: error ? new Error(error.message) : null,
  };
}

/**
 * Update rows matching filters. Returns updated rows (or first if single).
 */
export async function update<T extends TableName>(
  client: SupabaseClient<Database>,
  table: T,
  filters: Filters,
  payload: UpdateDto<T>,
  options?: { returning?: "single" | "all" },
): Promise<{ data: Row<T> | Row<T>[] | null; error: Error | null }> {
  let query: any = client
    .from(table)
    .update(payload as any)
    .select();
  query = applyFilters(query, filters);
  if (options?.returning === "single") {
    const { data, error } = await query.single();
    return {
      data: data as Row<T> | null,
      error: error ? new Error(error.message) : null,
    };
  }
  const { data, error } = await query;
  return {
    data: (data ?? []) as Row<T>[],
    error: error ? new Error(error.message) : null,
  };
}

/**
 * Upsert one or many rows with optional onConflict.
 */
export async function upsert<T extends TableName>(
  client: SupabaseClient<Database>,
  table: T,
  payload: InsertDto<T> | InsertDto<T>[],
  options?: UpsertOptions,
): Promise<{ data: Row<T>[] | null; error: Error | null }> {
  const opts = options?.onConflict
    ? { onConflict: options.onConflict }
    : undefined;
  const { data, error } = await client
    .from(table)
    .upsert(payload as any, opts)
    .select();
  return {
    data: (data ?? []) as Row<T>[],
    error: error ? new Error(error.message) : null,
  };
}

/**
 * Delete rows matching filters. Optionally return deleted rows.
 */
export async function remove<T extends TableName>(
  client: SupabaseClient<Database>,
  table: T,
  filters: Filters,
  options?: { returning?: boolean },
): Promise<{ data: Row<T>[] | null; error: Error | null }> {
  let query: any = client.from(table).delete();
  query = applyFilters(query, filters);
  if (options?.returning) {
    const { data, error } = await query.select();
    return {
      data: (data ?? []) as Row<T>[],
      error: error ? new Error(error.message) : null,
    };
  }
  const { error } = await query;
  return { data: null, error: error ? new Error(error.message) : null };
}

/** Convenience: get current user (server/browser). Use in one place instead of repeating getAuth(). */
export async function getAuthUser(client: SupabaseClient<Database>) {
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  return { user, error: error ? new Error(error.message) : null };
}
