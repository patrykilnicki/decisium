-- ============================================
-- LLM model pricing (append-only with active flag)
-- ============================================

CREATE TABLE IF NOT EXISTS public.llm_model_prices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_cost_per_1k NUMERIC(12, 6) NOT NULL,
  output_cost_per_1k NUMERIC(12, 6) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_model_prices_active
  ON public.llm_model_prices(provider, model)
  WHERE active;

CREATE INDEX IF NOT EXISTS idx_llm_model_prices_provider
  ON public.llm_model_prices(provider, model);

ALTER TABLE public.llm_model_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view model prices" ON public.llm_model_prices
  FOR SELECT USING (true);
