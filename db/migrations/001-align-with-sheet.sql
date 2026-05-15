-- =============================================================================
-- Migración 001: alinear schema con las columnas reales del Sheet KB
-- =============================================================================
-- Después de mapear headers reales del sheet generado por `dynamicSheetService.js`,
-- agregamos columnas que faltaban. Es ADITIVA — no toca columnas existentes.
-- Idempotente vía IF NOT EXISTS.
-- =============================================================================

-- services
ALTER TABLE services ADD COLUMN IF NOT EXISTS categoria        TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS precio_usd       NUMERIC(12,2);
ALTER TABLE services ADD COLUMN IF NOT EXISTS notas_internas   TEXT;
-- Renombramos duracion_min → duracion_texto si está en uso pero NULL, sino agregamos
-- (sheet manda "45 min", no INT — mejor texto)
ALTER TABLE services ADD COLUMN IF NOT EXISTS duracion_texto   TEXT;

-- service_descriptions
ALTER TABLE service_descriptions ADD COLUMN IF NOT EXISTS nombre_servicio   TEXT;
ALTER TABLE service_descriptions ADD COLUMN IF NOT EXISTS duracion_tipica   TEXT;
ALTER TABLE service_descriptions ADD COLUMN IF NOT EXISTS notas_importantes TEXT;

-- promotions
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS tipo_descuento   TEXT;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS valor_descuento  TEXT;  -- '20%' o '50000' — texto
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS mensaje_promo    TEXT;
-- Aliasamos `nombre` (que viene del sheet) a `titulo` que ya está — lo manejamos en el script.
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS activo           BOOLEAN NOT NULL DEFAULT TRUE;

-- schedules
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS sede_id           TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS dia_texto         TEXT;  -- 'lunes' del sheet

-- schedule_exceptions: hereda notas/origen del sheet
ALTER TABLE schedule_exceptions ADD COLUMN IF NOT EXISTS notas    TEXT;
ALTER TABLE schedule_exceptions ADD COLUMN IF NOT EXISTS sede_id  TEXT;

-- locations
ALTER TABLE locations ADD COLUMN IF NOT EXISTS servicios_disponibles TEXT[];
ALTER TABLE locations ADD COLUMN IF NOT EXISTS horarios_propios      TEXT;

-- faqs
ALTER TABLE faqs ADD COLUMN IF NOT EXISTS aplica_a_vertical TEXT;
ALTER TABLE faqs ADD COLUMN IF NOT EXISTS fuente            TEXT;
ALTER TABLE faqs ADD COLUMN IF NOT EXISTS prioridad         INT;
-- El sheet usa UNA fila por VARIANTE de pregunta. Renombramos campos:
-- pregunta_principal queda como nombre de pregunta principal (la primer variante de un intent_tag).
-- variantes_pregunta queda como array — el script lo agrupa.
ALTER TABLE faqs ADD COLUMN IF NOT EXISTS pregunta_variante TEXT;

-- objections
ALTER TABLE objections ADD COLUMN IF NOT EXISTS categoria        TEXT;
ALTER TABLE objections ADD COLUMN IF NOT EXISTS accion_siguiente TEXT;
ALTER TABLE objections ADD COLUMN IF NOT EXISTS fuente           TEXT;

-- team_contacts
ALTER TABLE team_contacts ADD COLUMN IF NOT EXISTS disponibilidad     TEXT;
ALTER TABLE team_contacts ADD COLUMN IF NOT EXISTS casos_que_atiende  TEXT;

-- escalations: trigger se descompone en tipo/descripcion/valor + umbral
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS trigger_tipo        TEXT;
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS trigger_descripcion TEXT;
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS trigger_valor       TEXT;
ALTER TABLE escalations ADD COLUMN IF NOT EXISTS umbral_intentos     INT;

-- restrictions
ALTER TABLE restrictions ADD COLUMN IF NOT EXISTS razon             TEXT;
ALTER TABLE restrictions ADD COLUMN IF NOT EXISTS aplica_a_agente   TEXT;

-- reengagement_sequences
ALTER TABLE reengagement_sequences ADD COLUMN IF NOT EXISTS nombre_secuencia     TEXT;
ALTER TABLE reengagement_sequences ADD COLUMN IF NOT EXISTS trigger_evento       TEXT;
ALTER TABLE reengagement_sequences ADD COLUMN IF NOT EXISTS dias_desde_contacto  INT;
ALTER TABLE reengagement_sequences ADD COLUMN IF NOT EXISTS accion_sin_respuesta TEXT;

-- agent_params: agregamos columna `agente` (sheet distingue por agente)
ALTER TABLE agent_params ADD COLUMN IF NOT EXISTS agente TEXT;

DO $$ BEGIN
  RAISE NOTICE 'Migration 001-align-with-sheet applied successfully.';
END $$;
