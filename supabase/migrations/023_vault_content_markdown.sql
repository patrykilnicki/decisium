-- Add content_markdown to vault_documents for Markdown UI storage
ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS content_markdown TEXT;
