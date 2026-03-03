-- Migration: 022_vault_schema.sql
-- Description: Vault - AI-first collaborative knowledge system (documents, collections, RAG chunks)

-- ============================================
-- Vault Collections
-- ============================================
CREATE TABLE vault_collections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vault_collections_tenant ON vault_collections(tenant_id);

-- ============================================
-- Vault Documents (CRDT/Yjs state)
-- ============================================
CREATE TABLE vault_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id UUID REFERENCES vault_collections(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  ydoc_state BYTEA,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vault_documents_tenant ON vault_documents(tenant_id);
CREATE INDEX idx_vault_documents_collection ON vault_documents(collection_id);
CREATE INDEX idx_vault_documents_updated ON vault_documents(updated_at DESC);

-- ============================================
-- Vault Changes (Event log)
-- ============================================
CREATE TABLE vault_changes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES vault_documents(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT,
  patch JSONB,
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vault_changes_document ON vault_changes(document_id, created_at DESC);

-- ============================================
-- Vault Snapshots
-- ============================================
CREATE TABLE vault_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES vault_documents(id) ON DELETE CASCADE,
  version INT NOT NULL,
  content_json JSONB,
  content_md TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vault_snapshots_document ON vault_snapshots(document_id, version DESC);

-- ============================================
-- Vault Chunks (RAG)
-- ============================================
CREATE TABLE vault_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES vault_documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  heading_path TEXT,
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  token_count INT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vault_chunks_document ON vault_chunks(document_id);
CREATE INDEX idx_vault_chunks_vector ON vault_chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- ============================================
-- RLS Policies
-- ============================================
ALTER TABLE vault_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_chunks ENABLE ROW LEVEL SECURITY;

-- vault_collections
CREATE POLICY "Users can view own collections" ON vault_collections
  FOR SELECT USING (auth.uid() = tenant_id);

CREATE POLICY "Users can insert own collections" ON vault_collections
  FOR INSERT WITH CHECK (auth.uid() = tenant_id);

CREATE POLICY "Users can update own collections" ON vault_collections
  FOR UPDATE USING (auth.uid() = tenant_id);

CREATE POLICY "Users can delete own collections" ON vault_collections
  FOR DELETE USING (auth.uid() = tenant_id);

-- vault_documents
CREATE POLICY "Users can view own documents" ON vault_documents
  FOR SELECT USING (auth.uid() = tenant_id);

CREATE POLICY "Users can insert own documents" ON vault_documents
  FOR INSERT WITH CHECK (auth.uid() = tenant_id);

CREATE POLICY "Users can update own documents" ON vault_documents
  FOR UPDATE USING (auth.uid() = tenant_id);

CREATE POLICY "Users can delete own documents" ON vault_documents
  FOR DELETE USING (auth.uid() = tenant_id);

-- vault_changes (via document)
CREATE POLICY "Users can view changes of own documents" ON vault_changes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vault_documents vd
      WHERE vd.id = vault_changes.document_id AND vd.tenant_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert changes to own documents" ON vault_changes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM vault_documents vd
      WHERE vd.id = vault_changes.document_id AND vd.tenant_id = auth.uid()
    )
  );

-- vault_snapshots (via document)
CREATE POLICY "Users can view snapshots of own documents" ON vault_snapshots
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vault_documents vd
      WHERE vd.id = vault_snapshots.document_id AND vd.tenant_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert snapshots to own documents" ON vault_snapshots
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM vault_documents vd
      WHERE vd.id = vault_snapshots.document_id AND vd.tenant_id = auth.uid()
    )
  );

-- vault_chunks (via document)
CREATE POLICY "Users can view chunks of own documents" ON vault_chunks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM vault_documents vd
      WHERE vd.id = vault_chunks.document_id AND vd.tenant_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert chunks to own documents" ON vault_chunks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM vault_documents vd
      WHERE vd.id = vault_chunks.document_id AND vd.tenant_id = auth.uid()
    )
  );

CREATE POLICY "Users can update chunks of own documents" ON vault_chunks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM vault_documents vd
      WHERE vd.id = vault_chunks.document_id AND vd.tenant_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete chunks of own documents" ON vault_chunks
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM vault_documents vd
      WHERE vd.id = vault_chunks.document_id AND vd.tenant_id = auth.uid()
    )
  );

-- ============================================
-- Updated_at trigger for vault_documents, vault_collections
-- ============================================
CREATE OR REPLACE FUNCTION update_vault_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_vault_documents_updated_at
  BEFORE UPDATE ON vault_documents
  FOR EACH ROW EXECUTE FUNCTION update_vault_updated_at();

CREATE TRIGGER trigger_vault_collections_updated_at
  BEFORE UPDATE ON vault_collections
  FOR EACH ROW EXECUTE FUNCTION update_vault_updated_at();

-- ============================================
-- RPC: match_vault_chunks (semantic search over vault)
-- ============================================
CREATE OR REPLACE FUNCTION match_vault_chunks(
  query_embedding VECTOR(1536),
  match_tenant_id UUID,
  match_document_id UUID DEFAULT NULL,
  match_collection_id UUID DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  chunk_index INT,
  heading_path TEXT,
  content TEXT,
  similarity FLOAT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    vc.id,
    vc.document_id,
    vc.chunk_index,
    vc.heading_path,
    vc.content,
    1 - (vc.embedding <=> query_embedding) AS similarity,
    vc.updated_at
  FROM vault_chunks vc
  JOIN vault_documents vd ON vd.id = vc.document_id
  WHERE vd.tenant_id = match_tenant_id
    AND vc.embedding IS NOT NULL
    AND 1 - (vc.embedding <=> query_embedding) > match_threshold
    AND (match_document_id IS NULL OR vc.document_id = match_document_id)
    AND (match_collection_id IS NULL OR vd.collection_id = match_collection_id)
  ORDER BY vc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
