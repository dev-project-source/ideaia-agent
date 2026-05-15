-- =============================================================================
-- Seed inicial del cliente piloto: Dr. Carlos Petro
-- =============================================================================
-- Inserta solo la fila en `clients` (root multi-tenant). Las 14 tablas hijas
-- las llena el workflow "First Activation" leyendo el Sheet.
--
-- Uso:
--   ssh root@45.13.59.95 "docker exec -i ideaia-postgres-agent \
--     psql -U ideaia -d ideaia_agent -v ON_ERROR_STOP=1" < db\seed-petro.sql
--
-- Devuelve el client_id generado por Postgres. Anotalo en .env como PILOT_CLIENT_ID.
-- =============================================================================

-- Idempotente: si ya existe un cliente con ese sheet_id, no lo duplica.
INSERT INTO clients (
  business_name,
  vertical,
  plan,
  timezone,
  locale,
  country_code,
  sheet_id,
  ghl_calendar_id,           -- se llena después de crear sub-cuenta GHL (Día 4)
  agent_params,
  status
)
VALUES (
  'Clínica Petro Estética',
  'medical',
  'advanced',
  'America/Bogota',
  'es_CO',
  'CO',
  '1JXALHpA-i7AP75vwJ4RDUU8pPd4OeW2wVGipHGsKzmo',
  NULL,
  '{"max_mensajes_sin_respuesta": 5, "calificacion_minima_agenda": "balanceado", "permite_agendar_sin_valoracion": false}'::jsonb,
  'active'
)
ON CONFLICT (sheet_id) DO UPDATE SET
  business_name = EXCLUDED.business_name,
  updated_at    = now()
RETURNING id, business_name, vertical, plan, sheet_id, created_at;

-- Mostrar fila final para verificación
\echo ''
\echo '→ Cliente Dr. Petro insertado / actualizado:'
SELECT id, business_name, vertical, plan, status, sheet_id
FROM clients
WHERE sheet_id = '1JXALHpA-i7AP75vwJ4RDUU8pPd4OeW2wVGipHGsKzmo';
