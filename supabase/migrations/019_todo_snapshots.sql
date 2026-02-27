-- ============================================
-- To-do snapshots generated from integrations
-- One snapshot per user per date
-- ============================================

CREATE TABLE IF NOT EXISTS public.todo_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_from_event TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migrate existing table from old schema (mode, window_from, window_to) to date-scoped
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'todo_snapshots' AND column_name = 'date'
  ) THEN
    ALTER TABLE public.todo_snapshots ADD COLUMN date DATE;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'todo_snapshots' AND column_name = 'window_from') THEN
      UPDATE public.todo_snapshots SET date = (window_from AT TIME ZONE 'UTC')::date WHERE date IS NULL;
    END IF;
    UPDATE public.todo_snapshots SET date = (created_at AT TIME ZONE 'UTC')::date WHERE date IS NULL;
    ALTER TABLE public.todo_snapshots ALTER COLUMN date SET NOT NULL;
    ALTER TABLE public.todo_snapshots DROP COLUMN IF EXISTS mode;
    ALTER TABLE public.todo_snapshots DROP COLUMN IF EXISTS window_from;
    ALTER TABLE public.todo_snapshots DROP COLUMN IF EXISTS window_to;
    DROP INDEX IF EXISTS public.idx_todo_snapshots_window;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_todo_snapshots_user_date
  ON public.todo_snapshots(user_id, date);
CREATE INDEX IF NOT EXISTS idx_todo_snapshots_user_created
  ON public.todo_snapshots(user_id, created_at DESC);

ALTER TABLE public.todo_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own todo snapshots" ON public.todo_snapshots;
CREATE POLICY "Users can view own todo snapshots" ON public.todo_snapshots
  FOR SELECT USING (auth.uid() = user_id);
