-- Enable Supabase Realtime for tables used by Home (calendar + tasks).
-- RLS is already enabled on these tables; Realtime respects RLS.

ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_atoms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.todo_snapshots;
