# Type usage audit: `@/types/database` and `@/types/supabase`

## Summary

- **`@/types/supabase`**: Used everywhere client is created except **`proxy.ts`**, which creates an untyped Supabase client.
- **`@/types/database`**: Used in cron routes, integrations lib, embeddings, and task types. Several API routes and server actions rely on inference from the typed client and do not import row/insert types.

---

## 1. Not using `@/types/supabase`

| File           | Issue                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **`proxy.ts`** | Calls `createServerClient()` without the `Database` generic. The client and all `.from().select()` results are untyped. |

**Already correct:**  
`lib/supabase/server.ts`, `lib/supabase/client.ts`, and `lib/supabase/admin.ts` all use `Database` from `@/types/supabase`, so any code that uses `createClient()` from those modules gets a `SupabaseClient<Database>` and does not need to import `@/types/supabase` itself.

---

## 2. Not using `@/types/database`

These files touch DB tables but do not import from `@/types/database`. Types are often inferred from `SupabaseClient<Database>`; adding imports is optional and mainly for clarity and consistency.

| File                                         | Tables / usage                                        | Suggestion                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`app/api/tasks/[taskId]/cancel/route.ts`** | `tasks` (fetch + update)                              | Optional: `import type { Task } from '@/types/database'` for `task` and `updated`.                                                                                          |
| **`app/api/tasks/[taskId]/retry/route.ts`**  | Same as above                                         | Same as above.                                                                                                                                                              |
| **`app/actions/ask.ts`**                     | `ask_threads`, `ask_messages`                         | Uses `AskThread` from `@/packages/agents/schemas/ask.schema`. Could use `AskThread` / `AskMessage` from `@/types/database` for return types; schema remains for validation. |
| **`app/actions/summaries.ts`**               | `daily_summaries`, `daily_events`, etc.               | Optional: annotate variables with `DailySummary`, `DailyEvent`, etc. from `@/types/database`.                                                                               |
| **`app/actions/daily.ts`**                   | `daily_events` insert                                 | Optional: use `DailyEventInsert` for the insert payload.                                                                                                                    |
| **`app/actions/onboarding.ts`**              | `users` update                                        | Optional: use `UserUpdate` from `@/types/database` for the update object.                                                                                                   |
| **`packages/agents/*`**                      | Various (daily*events, summaries, ask*\*, embeddings) | Rely on typed `createClient()` from server/admin. No imports from `@/types/database` or `@/types/supabase`; could add row/insert types where explicit types would help.     |

**Already using `@/types/database`:**  
`app/api/cron/*` (User), `lib/integrations/*` (Insert types), `lib/embeddings/store.ts` (EmbeddingInsert), `lib/tasks/task-types.ts` (Task, TaskInsert, TaskStatus), `app/ask/[threadId]/page.tsx` (AskMessage).

---

## 3. Recommendation

1. **Fix:** Type the Supabase client in **`proxy.ts`** with `Database` from `@/types/supabase` (see change below).
2. **Optional:** In the files listed in section 2, add imports from `@/types/database` where you want explicit row/insert/update types for clarity and consistency.
