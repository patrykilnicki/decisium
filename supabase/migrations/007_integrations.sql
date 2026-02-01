-- Migration: 007_integrations.sql
-- Description: Integration infrastructure for external apps (OAuth, activity atoms, signals, insights)

-- ============================================
-- Integration Connections
-- ============================================
CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'google_calendar', 'gmail', 'notion', 'linear'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'active', 'error', 'revoked'
  scopes TEXT[], -- Granted OAuth scopes
  external_user_id TEXT, -- User ID from provider
  external_email TEXT, -- Email from provider (for display)
  metadata JSONB DEFAULT '{}',
  connected_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT, -- 'success', 'error', 'partial'
  last_sync_error TEXT, -- Error message if sync failed
  sync_cursor TEXT, -- For incremental sync
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- ============================================
-- OAuth Tokens (Encrypted)
-- ============================================
CREATE TABLE integration_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  token_type TEXT DEFAULT 'Bearer',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(integration_id)
);

-- ============================================
-- Activity Atoms
-- ============================================
CREATE TABLE activity_atoms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL,
  
  -- Source
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  source_url TEXT,
  
  -- Content
  atom_type TEXT NOT NULL, -- 'event', 'message', 'task', 'note', 'comment'
  title TEXT,
  content TEXT NOT NULL,
  
  -- Temporal
  occurred_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER,
  
  -- Relations
  participants TEXT[],
  related_atom_ids UUID[],
  
  -- AI enrichment
  categories TEXT[],
  sentiment TEXT, -- 'positive', 'neutral', 'negative'
  importance TEXT, -- 'low', 'medium', 'high'
  
  -- Embedding reference
  embedding_id UUID REFERENCES embeddings(id) ON DELETE SET NULL,
  
  metadata JSONB DEFAULT '{}',
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, provider, external_id)
);

-- ============================================
-- User Signals (Patterns derived from atoms)
-- ============================================
CREATE TABLE user_signals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  signal_type TEXT NOT NULL, -- 'pattern', 'anomaly', 'milestone', 'trend'
  description TEXT NOT NULL,
  confidence DECIMAL(3,2), -- 0.00 to 1.00
  
  source_atom_ids UUID[],
  evidence_start TIMESTAMPTZ,
  evidence_end TIMESTAMPTZ,
  
  themes TEXT[],
  impact_area TEXT, -- 'work', 'personal', 'health', 'relationships'
  
  -- Embedding reference
  embedding_id UUID REFERENCES embeddings(id) ON DELETE SET NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- ============================================
-- Insight Sources (Pre-computed summaries)
-- ============================================
CREATE TABLE insight_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  source_type TEXT NOT NULL, -- 'daily_digest', 'weekly_pattern', 'integration_summary'
  granularity TEXT NOT NULL, -- 'day', 'week', 'month'
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  
  summary TEXT NOT NULL,
  key_facts JSONB DEFAULT '[]',
  actionable_insights JSONB DEFAULT '[]',
  
  related_atom_ids UUID[],
  related_signal_ids UUID[],
  
  -- Embedding reference
  embedding_id UUID REFERENCES embeddings(id) ON DELETE SET NULL,
  
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, source_type, granularity, period_start)
);

-- ============================================
-- Integration Audit Logs
-- ============================================
CREATE TABLE integration_audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL,
  event TEXT NOT NULL, -- 'connected', 'disconnected', 'synced', 'refreshed', 'error'
  provider TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================

-- Integrations
CREATE INDEX idx_integrations_user ON integrations(user_id);
CREATE INDEX idx_integrations_provider ON integrations(provider);
CREATE INDEX idx_integrations_status ON integrations(status);
CREATE INDEX idx_integrations_user_provider ON integrations(user_id, provider);

-- Integration Credentials
CREATE INDEX idx_integration_credentials_integration ON integration_credentials(integration_id);
CREATE INDEX idx_integration_credentials_expires ON integration_credentials(expires_at);

-- Activity Atoms
CREATE INDEX idx_activity_atoms_user_occurred ON activity_atoms(user_id, occurred_at DESC);
CREATE INDEX idx_activity_atoms_provider ON activity_atoms(provider, external_id);
CREATE INDEX idx_activity_atoms_user_provider ON activity_atoms(user_id, provider);
CREATE INDEX idx_activity_atoms_atom_type ON activity_atoms(atom_type);
CREATE INDEX idx_activity_atoms_integration ON activity_atoms(integration_id);
CREATE INDEX idx_activity_atoms_embedding ON activity_atoms(embedding_id);

-- User Signals
CREATE INDEX idx_user_signals_user_created ON user_signals(user_id, created_at DESC);
CREATE INDEX idx_user_signals_type ON user_signals(signal_type);
CREATE INDEX idx_user_signals_user_type ON user_signals(user_id, signal_type);
CREATE INDEX idx_user_signals_embedding ON user_signals(embedding_id);

-- Insight Sources
CREATE INDEX idx_insight_sources_user_period ON insight_sources(user_id, period_start DESC);
CREATE INDEX idx_insight_sources_type ON insight_sources(source_type);
CREATE INDEX idx_insight_sources_user_type ON insight_sources(user_id, source_type, granularity);
CREATE INDEX idx_insight_sources_embedding ON insight_sources(embedding_id);

-- Audit Logs
CREATE INDEX idx_integration_audit_logs_user ON integration_audit_logs(user_id, created_at DESC);
CREATE INDEX idx_integration_audit_logs_integration ON integration_audit_logs(integration_id);
CREATE INDEX idx_integration_audit_logs_event ON integration_audit_logs(event);

-- ============================================
-- Row Level Security
-- ============================================

-- Enable RLS
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_atoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE insight_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_audit_logs ENABLE ROW LEVEL SECURITY;

-- Integrations policies
CREATE POLICY "Users can view their own integrations"
  ON integrations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own integrations"
  ON integrations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own integrations"
  ON integrations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own integrations"
  ON integrations FOR DELETE
  USING (auth.uid() = user_id);

-- Integration Credentials policies (through integration ownership)
CREATE POLICY "Users can view credentials for their integrations"
  ON integration_credentials FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM integrations
      WHERE integrations.id = integration_credentials.integration_id
      AND integrations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert credentials for their integrations"
  ON integration_credentials FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM integrations
      WHERE integrations.id = integration_credentials.integration_id
      AND integrations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update credentials for their integrations"
  ON integration_credentials FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM integrations
      WHERE integrations.id = integration_credentials.integration_id
      AND integrations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete credentials for their integrations"
  ON integration_credentials FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM integrations
      WHERE integrations.id = integration_credentials.integration_id
      AND integrations.user_id = auth.uid()
    )
  );

-- Activity Atoms policies
CREATE POLICY "Users can view their own activity atoms"
  ON activity_atoms FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own activity atoms"
  ON activity_atoms FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own activity atoms"
  ON activity_atoms FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own activity atoms"
  ON activity_atoms FOR DELETE
  USING (auth.uid() = user_id);

-- User Signals policies
CREATE POLICY "Users can view their own signals"
  ON user_signals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own signals"
  ON user_signals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own signals"
  ON user_signals FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own signals"
  ON user_signals FOR DELETE
  USING (auth.uid() = user_id);

-- Insight Sources policies
CREATE POLICY "Users can view their own insight sources"
  ON insight_sources FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own insight sources"
  ON insight_sources FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own insight sources"
  ON insight_sources FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own insight sources"
  ON insight_sources FOR DELETE
  USING (auth.uid() = user_id);

-- Audit Logs policies (read-only for users)
CREATE POLICY "Users can view their own audit logs"
  ON integration_audit_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own audit logs"
  ON integration_audit_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- Functions
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_integration_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER trigger_integrations_updated_at
  BEFORE UPDATE ON integrations
  FOR EACH ROW
  EXECUTE FUNCTION update_integration_updated_at();

CREATE TRIGGER trigger_integration_credentials_updated_at
  BEFORE UPDATE ON integration_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_integration_updated_at();

CREATE TRIGGER trigger_activity_atoms_updated_at
  BEFORE UPDATE ON activity_atoms
  FOR EACH ROW
  EXECUTE FUNCTION update_integration_updated_at();

-- Function to search activity atoms by embedding similarity
CREATE OR REPLACE FUNCTION match_activity_atoms(
  query_embedding VECTOR(1536),
  match_user_id UUID,
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10,
  filter_provider TEXT DEFAULT NULL,
  filter_atom_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  provider TEXT,
  atom_type TEXT,
  title TEXT,
  content TEXT,
  occurred_at TIMESTAMPTZ,
  source_url TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    aa.id,
    aa.user_id,
    aa.provider,
    aa.atom_type,
    aa.title,
    aa.content,
    aa.occurred_at,
    aa.source_url,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM activity_atoms aa
  JOIN embeddings e ON aa.embedding_id = e.id
  WHERE aa.user_id = match_user_id
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
    AND (filter_provider IS NULL OR aa.provider = filter_provider)
    AND (filter_atom_type IS NULL OR aa.atom_type = filter_atom_type)
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
