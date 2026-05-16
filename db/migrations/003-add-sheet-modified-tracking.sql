-- =============================================================================
-- Migración 003: tracking de modifiedTime del Sheet
-- =============================================================================
-- Para que el cron de KB Sync pueda decidir si vale la pena re-sincronizar:
-- si el Sheet del cliente no cambió desde la última sync, no hacemos nada
-- (ahorra calls a OpenAI embeddings).
-- =============================================================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_sheet_modified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_clients_active_sync
  ON clients(status, last_sync_at)
  WHERE status = 'active';

DO $$ BEGIN
  RAISE NOTICE 'Migration 003-add-sheet-modified-tracking applied.';
END $$;
