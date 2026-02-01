-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  timezone TEXT DEFAULT 'UTC',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily events table
CREATE TABLE IF NOT EXISTS public.daily_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'agent', 'system')),
  type TEXT NOT NULL CHECK (type IN ('note', 'question', 'note+question', 'answer', 'summary')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT daily_events_user_date_idx UNIQUE (user_id, date, created_at)
);

-- Daily summaries table
CREATE TABLE IF NOT EXISTS public.daily_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  content JSONB NOT NULL, -- {facts: string[], insight: string, suggestion?: string}
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT daily_summaries_user_date_unique UNIQUE (user_id, date)
);

-- Weekly summaries table
CREATE TABLE IF NOT EXISTS public.weekly_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL, -- Monday of the week
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT weekly_summaries_user_week_unique UNIQUE (user_id, week_start)
);

-- Monthly summaries table
CREATE TABLE IF NOT EXISTS public.monthly_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  month_start DATE NOT NULL, -- First day of the month
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT monthly_summaries_user_month_unique UNIQUE (user_id, month_start)
);

-- Ask AI threads table
CREATE TABLE IF NOT EXISTS public.ask_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ask AI messages table
CREATE TABLE IF NOT EXISTS public.ask_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID NOT NULL REFERENCES public.ask_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Embeddings table for vector store
CREATE TABLE IF NOT EXISTS public.embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding VECTOR(1536), -- OpenAI embedding dimension
  metadata JSONB, -- {type: 'daily_event' | 'summary', source_id: uuid, date: date}
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_daily_events_user_date ON public.daily_events(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_events_user_created ON public.daily_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_user_date ON public.daily_summaries(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_summaries_user_week ON public.weekly_summaries(user_id, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_summaries_user_month ON public.monthly_summaries(user_id, month_start DESC);
CREATE INDEX IF NOT EXISTS idx_ask_threads_user ON public.ask_threads(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ask_messages_thread ON public.ask_messages(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_embeddings_user ON public.embeddings(user_id);

-- Row Level Security (RLS) policies
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ask_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ask_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embeddings ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own data
CREATE POLICY "Users can view own profile" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Daily events policies
CREATE POLICY "Users can view own daily events" ON public.daily_events
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own daily events" ON public.daily_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Daily summaries policies
CREATE POLICY "Users can view own daily summaries" ON public.daily_summaries
  FOR SELECT USING (auth.uid() = user_id);

-- Weekly summaries policies
CREATE POLICY "Users can view own weekly summaries" ON public.weekly_summaries
  FOR SELECT USING (auth.uid() = user_id);

-- Monthly summaries policies
CREATE POLICY "Users can view own monthly summaries" ON public.monthly_summaries
  FOR SELECT USING (auth.uid() = user_id);

-- Ask threads policies
CREATE POLICY "Users can view own threads" ON public.ask_threads
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own threads" ON public.ask_threads
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own threads" ON public.ask_threads
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own threads" ON public.ask_threads
  FOR DELETE USING (auth.uid() = user_id);

-- Ask messages policies
CREATE POLICY "Users can view messages in own threads" ON public.ask_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.ask_threads
      WHERE ask_threads.id = ask_messages.thread_id
      AND ask_threads.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert messages in own threads" ON public.ask_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ask_threads
      WHERE ask_threads.id = ask_messages.thread_id
      AND ask_threads.user_id = auth.uid()
    )
  );

-- Embeddings policies
CREATE POLICY "Users can view own embeddings" ON public.embeddings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own embeddings" ON public.embeddings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Function to automatically create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create user profile
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
