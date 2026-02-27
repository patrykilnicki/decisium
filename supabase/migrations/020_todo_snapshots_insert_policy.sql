-- Allow authenticated users to insert their own todo snapshots (required for
-- GET/POST /api/integrations/todos when using user-scoped Supabase client).
CREATE POLICY "Users can insert own todo snapshots" ON public.todo_snapshots
  FOR INSERT WITH CHECK (auth.uid() = user_id);
