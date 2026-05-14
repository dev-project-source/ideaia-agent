# IDEA IA · Agent RAG Runtime

Agente IA en n8n que consume el KB generado por `ideaia-onboarding` (Google Sheet de 16 pestañas) y responde a leads vía GHL.

> **Estado:** en construcción — Fase A en curso. Cliente piloto: Dr. Carlos Petro.

## Contexto obligatorio antes de tocar nada

Leer en este orden:

1. **[`../ideaia-onboarding/docs/PLANIFICACION_RAG.md`](../ideaia-onboarding/docs/PLANIFICACION_RAG.md)** — plan completo del RAG (v2.0 aprobada por el jefe)
2. **[`../ideaia-onboarding/docs/RAG_KICKOFF_BRIEF.md`](../ideaia-onboarding/docs/RAG_KICKOFF_BRIEF.md)** — decisiones cerradas + plan día por día
3. **[`../ideaia-onboarding/CLAUDE.md`](../ideaia-onboarding/CLAUDE.md)** — cómo se genera el sheet que vas a consumir

## Stack confirmado

| Capa | Tecnología | Hosting |
|---|---|---|
| Knowledge estructurado | Postgres 15+ con pgvector | Contabo via Easypanel |
| Knowledge semántico | pgvector (HNSW, cosine) | misma instancia Postgres |
| Session | Redis | Upstash serverless |
| Orquestación | n8n | Contabo via Easypanel — **instancia centralizada nueva** (NO por cliente) |
| LLM | OpenAI GPT-4o-mini | API (cuenta IDEA IA existente) |
| Embeddings | `text-embedding-3-small` (1536d) | API OpenAI |
| Disponibilidad real | GHL Calendar API | — |
| KB source editable | Google Sheets | Drive (generado por onboarding) |

**No re-discutir decisiones de stack — están cerradas en `RAG_KICKOFF_BRIEF.md`.**

## Regla de oro del proyecto

> El Sheet alimenta la KB. La KB publicada vive en Postgres/pgvector.
> El retrieval consulta esa KB. El agente genera la respuesta.
> No confundir el Sheet (editable) con la KB operativa (Postgres).
> Redis es SOLO Session Layer — nunca guarda KB.

## Multi-tenancy

Un único workflow del agente, con filtering por `client_id` en cada query y en cada vector search. Cliente piloto = Dr. Carlos Petro = primer `client_id` en `kb_config`.

## Anti-alucinación

El system prompt del agente incluye:

```
- Solo respondes con info presente en el contexto recuperado.
- Si la pregunta requiere un dato que NO está en el contexto, no inventes:
  responde "no tengo ese dato confirmado, te conecto con el equipo".
- Disponibilidad real solo se confirma contra GHL — nunca digas "hay cupo"
  basado en tablas del sheet.
- Restricciones del cliente (RESTRICCIONES tab) son absolutas.
```

## Estructura del repo

```
ideaia-agent/
├── db/
│   ├── schema.sql                 # 13 tablas + extension pgvector + índices HNSW
│   ├── migrations/                # cambios incrementales
│   └── seed-petro.sh              # datos del piloto
├── n8n-workflows/
│   ├── 01-client-first-activation.json
│   ├── 02-kb-sync-cron.json
│   └── 03-message-handler.json
├── prompts/
│   ├── contrato-interpretacion-kb.md
│   ├── clasificador-intencion.md
│   └── resolutor-entidad.md
├── scripts/
│   ├── chunking.js
│   ├── embed-batch.js
│   ├── test-conversation.js
│   └── ghl-webhook-setup.js
├── docker/
│   └── docker-compose.yml         # Postgres+pgvector dev local
└── docs/
    ├── ARCHITECTURE.md
    ├── OPERATIONS.md
    └── DEMO.md
```

## Convenciones

- **Idioma:** todo en español neutro LATAM. Las tablas Postgres usan nombres en inglés (`services`, `pricing`) pero columnas en español del KB (`nombre`, `precio_referencial`).
- **IDs estables:** `SRV_001`, `PRO_001`, `FAQ_001`, etc. — vienen del Sheet, no se regeneran.
- **client_id:** UUID. Filtro obligatorio en TODA query.
- **Secretos:** nunca al repo. `.env` está gitignored. Credenciales reales se cargan en variables de n8n y en el `.env` local.
- **Anti-alucinación en código:** si una query no encuentra un dato, el código devuelve `null` y el agente responde "no tengo ese dato confirmado". Nunca se completa con placeholder.

## Plan de implementación (5-6 días)

Ver `RAG_KICKOFF_BRIEF.md` sección 4. Resumen:

- **Día 1:** Infra (Postgres + pgvector + n8n + Upstash)
- **Día 2:** Workflow "Client First Activation"
- **Día 3:** Workflow "Message Handler" base
- **Día 4:** Tests + ajustes
- **Día 5:** Cron de sync continuo + GHL pipeline
- **Día 6:** Demo al jefe

## Lo que NO se hace en este alcance

- Métricas / dashboard
- GHL Calendar sync desde HORARIOS (fase E — separada)
- Apps Script para sync inmediato
- Reenganche automatizado
- Booking real de citas (escalado a humano por ahora)
- Multi-canal (solo el default de GHL)

## Definition of Done

Ver `RAG_KICKOFF_BRIEF.md` sección 9.
