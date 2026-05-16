-- =============================================================================
-- Migración 002: tool_calls en messages
-- =============================================================================
-- Cada mensaje del assistant puede haber ejecutado N tools. Las guardamos como
-- array JSONB con la forma:
--   [
--     { "name": "consultar_calendario_ghl", "arguments": {...}, "result": {...}, "latency_ms": 120 },
--     ...
--   ]
-- =============================================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  RAISE NOTICE 'Migration 002-add-tool-calls applied.';
END $$;
