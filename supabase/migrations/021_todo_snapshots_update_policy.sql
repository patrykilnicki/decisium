-- Allow users to update their own todo snapshots (for item actions: resolve, rename, change date, delete).
CREATE POLICY "Users can update own todo snapshots" ON public.todo_snapshots
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
