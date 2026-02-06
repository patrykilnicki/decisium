-- ============================================
-- Seed: ceny modeli używanych w aplikacji
-- LLM: packages/agents/lib/llm.ts (DEFAULT_MODELS)
-- Embeddings: packages/agents/lib/embeddings.ts (EMBEDDING_MODEL || text-embedding-3-small)
-- Źródła: platform.openai.com/docs/pricing (Standard), docs.anthropic.com, openrouter.ai/pricing
-- Ceny w USD per 1k tokenów (input_cost_per_1k, output_cost_per_1k)
-- ============================================

INSERT INTO public.llm_model_prices (
  provider,
  model,
  input_cost_per_1k,
  output_cost_per_1k,
  currency,
  active
)
SELECT * FROM (VALUES
  -- LLM (llm.ts: gpt-4o, claude-sonnet-4-20250514, openai/gpt-4-turbo; opcjonalnie gpt-4o-mini przez LLM_MODEL)
  ('openai', 'gpt-4o', 0.0025, 0.01, 'USD', true),
  ('openai', 'gpt-4o-mini', 0.00015, 0.0006, 'USD', true),
  ('anthropic', 'claude-sonnet-4-20250514', 0.003, 0.015, 'USD', true),
  ('openrouter', 'openai/gpt-4-turbo', 0.01, 0.03, 'USD', true),
  -- Embeddings (packages/agents/lib/embeddings.ts: text-embedding-3-small, tylko input)
  ('openai', 'text-embedding-3-small', 0.00002, 0, 'USD', true)
) AS v(provider, model, input_cost_per_1k, output_cost_per_1k, currency, active)
WHERE NOT EXISTS (
  SELECT 1 FROM public.llm_model_prices p
  WHERE p.provider = v.provider AND p.model = v.model AND p.active
);
