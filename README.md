# IDEA IA — Agent RAG Runtime

Agente IA en n8n que lee el KB de cada cliente (Google Sheet de 16 pestañas generado por `ideaia-onboarding`) desde Postgres + pgvector y responde a leads vía GHL.

**Estado:** en construcción. Cliente piloto: Dr. Carlos Petro.

## Documentación

- **Plan completo:** [`../ideaia-onboarding/docs/PLANIFICACION_RAG.md`](../ideaia-onboarding/docs/PLANIFICACION_RAG.md)
- **Brief de kickoff:** [`../ideaia-onboarding/docs/RAG_KICKOFF_BRIEF.md`](../ideaia-onboarding/docs/RAG_KICKOFF_BRIEF.md)
- **Instrucciones para Claude Code:** [`CLAUDE.md`](CLAUDE.md)

## Stack

- **Orquestación:** n8n self-hosted (Contabo via Easypanel)
- **Knowledge Layer estructurado:** Postgres self-hosted (Contabo via Easypanel)
- **Knowledge Layer semántico:** pgvector (extensión de Postgres)
- **Session Layer:** Upstash Redis (serverless)
- **LLM:** OpenAI GPT-4o-mini (con plan de migrar a Claude Haiku 3.5 si la calidad lo amerita)
- **Embeddings:** OpenAI `text-embedding-3-small` (1536d)
- **Calendar source of truth:** GHL Calendar API

## Estructura

```
ideaia-agent/
├── db/                     # Schema Postgres + migraciones + seeds
├── n8n-workflows/          # Workflows exportados como JSON
├── prompts/                # System prompts del agente
├── scripts/                # Utilidades (chunking, embeddings, tests)
├── docker/                 # Compose para dev local
└── docs/                   # Arquitectura, operaciones, demo
```

## Setup local

```bash
cp .env.example .env
# Editar .env con las credenciales reales (nunca commitearlas)
npm install
```

## Comandos principales

(Pendientes — se completan a medida que se construye el sistema)
