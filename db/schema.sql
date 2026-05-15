-- =============================================================================
-- IDEA IA · Agent RAG Runtime · Postgres Schema
-- =============================================================================
-- Estructura:
--   - Extensions (pgvector, pg_trgm, unaccent, uuid-ossp)
--   - Knowledge Layer:    14 tablas (clients + 13 pestañas del Sheet)
--   - Vector Layer:        1 tabla  (kb_chunks con embedding 1536d)
--   - Runtime/Session:     4 tablas (conversations, messages, audit_log, sync_runs)
--
-- Convenciones:
--   - PK: UUID v4 (uuid-ossp gen_random_uuid)
--   - client_id: FK obligatoria en CADA tabla del KB (multi-tenancy estricto)
--   - sync_version: int incrementado en cada First Activation/sync — permite
--     detectar filas obsoletas y purgar
--   - external_id: el ID estable que viene del Sheet (SRV_001, FAQ_001, etc).
--     Junto con client_id es la clave de upsert.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions (idempotentes — el init.sql del Day 1 ya las cargó, esto es safe)
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- =============================================================================
-- 1. CLIENTES (multi-tenant root)
-- =============================================================================
-- Equivalente a la pestaña KB_CONFIG + PARAMETROS_AGENTES del Sheet.
-- Una fila por cliente del programa IDEA IA.
-- =============================================================================
CREATE TABLE IF NOT EXISTS clients (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_name       TEXT NOT NULL,
  vertical            TEXT NOT NULL,               -- estetica | salud | educacion | retail | otro
  plan                TEXT NOT NULL,               -- start | adv | elite
  timezone            TEXT NOT NULL DEFAULT 'America/Bogota',
  locale              TEXT NOT NULL DEFAULT 'es_CO',
  country_code        TEXT,                        -- CO, MX, AR, ES, PE, CL, VE

  -- Integraciones
  sheet_id            TEXT UNIQUE,                 -- spreadsheetId de Google Sheets
  sheet_url           TEXT,
  kb_folder_url       TEXT,
  ghl_location_id     TEXT,
  ghl_calendar_id     TEXT,
  ghl_api_key_ref     TEXT,                        -- nombre de la credencial en n8n (NO la key real)

  -- Parámetros operacionales (de PARAMETROS_AGENTES tab)
  agent_params        JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Lifecycle
  status              TEXT NOT NULL DEFAULT 'active', -- active | paused | archived
  current_sync_version INT NOT NULL DEFAULT 0,
  last_sync_at        TIMESTAMPTZ,
  last_sync_status    TEXT,                        -- ok | partial | failed

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_vertical ON clients(vertical);
CREATE INDEX IF NOT EXISTS idx_clients_status   ON clients(status);

-- =============================================================================
-- 2. BRANDING (ADN_MARCA + ESTILO_RESPUESTA)
-- =============================================================================
-- 1 fila por cliente. Se inyecta SIEMPRE en el system prompt del agente.
-- =============================================================================
CREATE TABLE IF NOT EXISTS client_branding (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id           UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,

  -- De ADN_MARCA
  nombre_agente       TEXT,
  tagline             TEXT,
  propuesta_valor     TEXT,
  tono                TEXT,
  valores             TEXT[],

  -- De ESTILO_RESPUESTA (cada uno es un dropdown)
  formalidad          TEXT,                        -- formal | semi-formal | informal
  uso_emojis          TEXT,                        -- nunca | ocasional | frecuente
  longitud            TEXT,                        -- corto | medio | largo
  idioma              TEXT,                        -- es_CO | es_MX | es_AR | ...
  tratamiento         TEXT,                        -- TU | USTED

  -- Catch-all para parámetros adicionales de estilo
  extras              JSONB NOT NULL DEFAULT '{}'::jsonb,

  sync_version        INT NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 3. SERVICIOS (catálogo unificado)
-- =============================================================================
CREATE TABLE IF NOT EXISTS services (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_id              TEXT NOT NULL,             -- SRV_001
  procedimiento_referencia TEXT,                      -- "Botox", "Inglés A1", etc.
  servicio                 TEXT NOT NULL,
  variante                 TEXT,
  requiere_valoracion      BOOLEAN NOT NULL DEFAULT FALSE,
  tipo_precio              TEXT,                      -- Fijo | Desde
  precio_servicio          NUMERIC(12,2),
  precio_valoracion        NUMERIC(12,2),
  moneda                   TEXT NOT NULL DEFAULT 'COP', -- COP | USD | MXN | ARS | EUR | PEN | CLP | VES
  aliases                  TEXT[],
  tags                     TEXT[],
  duracion_min             INT,
  activo                   BOOLEAN NOT NULL DEFAULT TRUE,
  sync_version             INT NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_services_client_active ON services(client_id, activo);
-- Trigram para búsqueda fuzzy por nombre/aliases
CREATE INDEX IF NOT EXISTS idx_services_servicio_trgm ON services USING GIN (servicio gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_services_aliases_trgm  ON services USING GIN (aliases);
CREATE INDEX IF NOT EXISTS idx_services_tags          ON services USING GIN (tags);

-- =============================================================================
-- 4. DESCRIPCIONES (textos largos por servicio)
-- =============================================================================
-- Esta tabla alimenta los chunks de pgvector pero también guarda el texto
-- original (para citas en respuestas, debugging, etc.)
-- =============================================================================
CREATE TABLE IF NOT EXISTS service_descriptions (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_id              TEXT NOT NULL,             -- igual al SRV_xxx del catálogo
  que_es                   TEXT,
  para_quien               TEXT,
  protocolo                TEXT,
  indicaciones_previas     TEXT,
  cuidados_posteriores     TEXT,
  contraindicaciones       TEXT,
  resultados               TEXT,
  faq                      TEXT,                      -- FAQs específicas del servicio
  sync_version             INT NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, external_id)
);

-- =============================================================================
-- 5. PROMOCIONES
-- =============================================================================
CREATE TABLE IF NOT EXISTS promotions (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_id              TEXT NOT NULL,             -- PRO_001
  titulo                   TEXT NOT NULL,
  descripcion              TEXT,
  fecha_inicio             DATE,
  fecha_fin                DATE,
  condiciones              TEXT,
  precio_promocional       NUMERIC(12,2),
  moneda                   TEXT NOT NULL DEFAULT 'COP',
  estado                   TEXT NOT NULL DEFAULT 'activa', -- activa | pausada | vencida
  servicios_aplicables     TEXT[],                    -- array de SRV_xxx
  sync_version             INT NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_promotions_active ON promotions(client_id, estado, fecha_fin);

-- =============================================================================
-- 6. HORARIOS (regulares, sección A de la pestaña)
-- =============================================================================
CREATE TABLE IF NOT EXISTS schedules (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_id              TEXT NOT NULL,             -- HR_001 a HR_007 (lun-dom)
  dia_semana               INT NOT NULL,              -- 1=lunes ... 7=domingo
  hora_apertura            TIME,
  hora_cierre              TIME,
  abierto                  BOOLEAN NOT NULL DEFAULT TRUE,
  notas                    TEXT,
  sync_version             INT NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, external_id),
  CHECK (dia_semana BETWEEN 1 AND 7)
);

-- =============================================================================
-- 7. EXCEPCIONES DE HORARIO (festivos + ad-hoc, sección B)
-- =============================================================================
CREATE TABLE IF NOT EXISTS schedule_exceptions (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_id              TEXT,                      -- puede ser autogen o vacío
  fecha                    DATE NOT NULL,
  fecha_fin                DATE,                      -- para rangos (vacaciones)
  tipo                     TEXT NOT NULL DEFAULT 'cerrado', -- cerrado | horario_especial
  descripcion              TEXT,
  hora_apertura_especial   TIME,
  hora_cierre_especial     TIME,
  origen                   TEXT NOT NULL DEFAULT 'manual',  -- manual | festivo_pais
  sync_version             INT NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sched_excep_client_fecha ON schedule_exceptions(client_id, fecha);

-- =============================================================================
-- 8. SEDES
-- =============================================================================
CREATE TABLE IF NOT EXISTS locations (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_id              TEXT NOT NULL,             -- LOC_001
  nombre                   TEXT NOT NULL,
  direccion                TEXT,
  ciudad                   TEXT,
  pais                     TEXT,
  indicaciones_acceso      TEXT,
  telefono                 TEXT,
  whatsapp                 TEXT,
  activo                   BOOLEAN NOT NULL DEFAULT TRUE,
  sync_version             INT NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, external_id)
);

-- =============================================================================
-- 9. FAQ
-- =============================================================================
CREATE TABLE IF NOT EXISTS faqs (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_id              TEXT NOT NULL,             -- FAQ_001
  intent_tag               TEXT NOT NULL,             -- "precios", "horarios", "ubicacion", etc.
  pregunta_principal       TEXT NOT NULL,
  variantes_pregunta       TEXT[],
  respuesta                TEXT NOT NULL,
  accion_siguiente         TEXT,                      -- "agendar" | "enviar_brochure" | "escalar" | null
  sync_version             INT NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_faqs_intent ON faqs(client_id, intent_tag);

-- =============================================================================
-- 10. OBJECIONES
-- =============================================================================
CREATE TABLE IF NOT EXISTS objections (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_id              TEXT NOT NULL,             -- OBJ_001
  frase_trigger            TEXT NOT NULL,
  variantes_trigger        TEXT[],
  respuesta_principal      TEXT NOT NULL,
  respuesta_seguimiento    TEXT,
  cierre_sugerido          TEXT,
  sync_version             INT NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, external_id)
);

-- =============================================================================
-- 11. EQUIPO Y CONTACTOS
-- =============================================================================
CREATE TABLE IF NOT EXISTS team_contacts (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_id              TEXT NOT NULL,             -- CON_001
  nombre                   TEXT NOT NULL,
  rol                      TEXT,
  contacto                 TEXT,                      -- email/teléfono/etc
  canal_preferido          TEXT,                      -- whatsapp | email | llamada
  prioridad_escalacion     INT NOT NULL DEFAULT 99,   -- 1 = primero a contactar
  activo                   BOOLEAN NOT NULL DEFAULT TRUE,
  sync_version             INT NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_team_prioridad ON team_contacts(client_id, prioridad_escalacion) WHERE activo;

-- =============================================================================
-- 12. ESCALAMIENTO
-- =============================================================================
CREATE TABLE IF NOT EXISTS escalations (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_id              TEXT NOT NULL,             -- ESC_001
  trigger                  TEXT NOT NULL,
  mensaje_handoff          TEXT,
  destino                  TEXT,                      -- nombre o ref a team_contacts
  urgencia                 TEXT,                      -- baja | media | alta | critica
  sla_minutos              INT,
  sync_version             INT NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, external_id)
);

-- =============================================================================
-- 13. RESTRICCIONES
-- =============================================================================
-- Inyectadas SIEMPRE en el system prompt — son guardrails absolutos.
-- =============================================================================
CREATE TABLE IF NOT EXISTS restrictions (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_id              TEXT NOT NULL,             -- RES_001
  tipo                     TEXT NOT NULL,             -- legal | medico | comercial | otro
  descripcion              TEXT NOT NULL,
  severidad                TEXT NOT NULL DEFAULT 'alta', -- alta | media | baja
  mensaje_defleccion       TEXT,                      -- qué responder cuando se viola
  sync_version             INT NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_restrictions_severidad ON restrictions(client_id, severidad);

-- =============================================================================
-- 14. REENGANCHE
-- =============================================================================
CREATE TABLE IF NOT EXISTS reengagement_sequences (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_id              TEXT NOT NULL,             -- REE_001
  trigger                  TEXT NOT NULL,             -- "no_respondio_24h" | "abandonó_agenda" | ...
  mensaje_1                TEXT,
  delay_1_horas            INT,
  mensaje_2                TEXT,
  delay_2_horas            INT,
  mensaje_3                TEXT,
  delay_3_horas            INT,
  plan_minimo              TEXT,                      -- adv | elite
  activo                   BOOLEAN NOT NULL DEFAULT TRUE,
  sync_version             INT NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, external_id)
);

-- =============================================================================
-- 15. KB CHUNKS (Vector Layer — pgvector)
-- =============================================================================
-- Chunks de texto largo de:
--   - service_descriptions.*  (que_es, para_quien, protocolo, etc.)
--   - faqs.respuesta
--   - objections.respuesta_principal/seguimiento
--   - client_branding.tagline + propuesta_valor + valores (todo concatenado)
--   - restrictions.descripcion + mensaje_defleccion
--
-- Cada chunk lleva su origen (source_table + source_external_id) para que el
-- agente pueda citar de dónde vino la info.
-- =============================================================================
CREATE TABLE IF NOT EXISTS kb_chunks (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source_table             TEXT NOT NULL,             -- 'service_descriptions' | 'faqs' | 'objections' | 'client_branding' | 'restrictions'
  source_external_id       TEXT NOT NULL,             -- SRV_xxx, FAQ_xxx, OBJ_xxx, RES_xxx, 'BRANDING'
  source_field             TEXT,                      -- 'que_es', 'respuesta', 'respuesta_seguimiento', etc.
  chunk_index              INT NOT NULL DEFAULT 0,    -- 0 si el campo entró entero, >0 si se partió
  content_text             TEXT NOT NULL,             -- el texto del chunk (~200-800 tokens)
  tokens_estimated         INT,
  embedding                VECTOR(1536) NOT NULL,     -- text-embedding-3-small
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  sync_version             INT NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW para retrieval semántico (cosine distance, recomendado para OpenAI embeddings).
-- m=16, ef_construction=64 son los defaults de pgvector — suficientes para nuestro
-- volumen (cientos a miles de chunks por cliente).
CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding_hnsw
  ON kb_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Index parcial por cliente para filtering rápido
CREATE INDEX IF NOT EXISTS idx_kb_chunks_client ON kb_chunks(client_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_source ON kb_chunks(client_id, source_table, source_external_id);

-- =============================================================================
-- 16. AGENT PARAMS (PARAMETROS_AGENTES tab)
-- =============================================================================
-- Tabla key-value para parámetros operacionales como:
--   max_mensajes_sin_respuesta, calificacion_minima_agenda, tiempo_max_sesion_min,
--   permite_agendar_sin_valoracion, etc.
-- Se podría meter en clients.agent_params (JSONB) pero tenerlo aparte facilita
-- versionado y dropdowns en el sheet.
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_params (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  parametro                TEXT NOT NULL,
  valor                    TEXT NOT NULL,
  tipo                     TEXT NOT NULL DEFAULT 'string', -- string | int | bool | json
  descripcion              TEXT,
  sync_version             INT NOT NULL DEFAULT 0,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, parametro)
);

-- =============================================================================
-- 17. CONVERSATIONS (sesiones de chat)
-- =============================================================================
CREATE TABLE IF NOT EXISTS conversations (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ghl_contact_id           TEXT,
  channel                  TEXT,                      -- whatsapp | instagram | web | otro
  started_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at                 TIMESTAMPTZ,
  status                   TEXT NOT NULL DEFAULT 'active', -- active | completed | escalated | abandoned
  intent_inicial           TEXT,
  outcome                  TEXT,                      -- agenda | escalado | info_solicitada | sin_respuesta
  summary                  TEXT,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_conversations_client_status ON conversations(client_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_contact ON conversations(client_id, ghl_contact_id);

-- =============================================================================
-- 18. MESSAGES (historial completo, audit log granular)
-- =============================================================================
CREATE TABLE IF NOT EXISTS messages (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id          UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  role                     TEXT NOT NULL,             -- user | assistant | system | tool
  content                  TEXT NOT NULL,

  -- Retrieval metadata (solo para role=assistant)
  intent_detected          TEXT,
  entities_resolved        JSONB,
  chunks_retrieved         JSONB,                     -- array de chunk_ids + scores
  sql_queries              JSONB,                     -- queries SQL que se corrieron
  ghl_calls                JSONB,                     -- llamadas a GHL API

  -- LLM metadata
  model_used               TEXT,
  tokens_in                INT,
  tokens_out               INT,
  latency_ms               INT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_client_created ON messages(client_id, created_at DESC);

-- =============================================================================
-- 19. AUDIT LOG (eventos críticos del sistema)
-- =============================================================================
-- Ejemplos: first_activation_started, first_activation_completed,
-- sync_run_started, sync_run_completed, ghl_webhook_received,
-- escalation_triggered, restriction_violated, llm_refused.
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                UUID REFERENCES clients(id) ON DELETE SET NULL,
  event_type               TEXT NOT NULL,
  payload                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  severity                 TEXT NOT NULL DEFAULT 'info', -- info | warn | error
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_client_type ON audit_log(client_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_log(severity, created_at DESC) WHERE severity <> 'info';

-- =============================================================================
-- 20. SYNC RUNS (historial de sincronización Sheet → Postgres)
-- =============================================================================
CREATE TABLE IF NOT EXISTS sync_runs (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  trigger_type             TEXT NOT NULL,             -- first_activation | cron | manual | sheet_edit
  sync_version             INT NOT NULL,
  started_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at              TIMESTAMPTZ,
  status                   TEXT NOT NULL DEFAULT 'running', -- running | ok | partial | failed
  rows_upserted            JSONB NOT NULL DEFAULT '{}'::jsonb, -- por tabla: {services: 12, faqs: 30, ...}
  chunks_generated         INT,
  embeddings_generated     INT,
  errors                   JSONB NOT NULL DEFAULT '[]'::jsonb,
  duration_ms              INT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_client_started ON sync_runs(client_id, started_at DESC);

-- =============================================================================
-- TRIGGERS: auto-bump updated_at
-- =============================================================================
CREATE OR REPLACE FUNCTION bump_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'clients','client_branding','services','service_descriptions','promotions',
      'schedules','schedule_exceptions','locations','faqs','objections',
      'team_contacts','escalations','restrictions','reengagement_sequences',
      'kb_chunks','agent_params'
    ])
  LOOP
    EXECUTE format($f$
      DROP TRIGGER IF EXISTS trg_%I_bump ON %I;
      CREATE TRIGGER trg_%I_bump BEFORE UPDATE ON %I
        FOR EACH ROW EXECUTE FUNCTION bump_updated_at();
    $f$, t, t, t, t);
  END LOOP;
END $$;

-- =============================================================================
-- DONE
-- =============================================================================
DO $$ BEGIN
  RAISE NOTICE 'Schema applied: 20 tables, pgvector HNSW index ready.';
END $$;
