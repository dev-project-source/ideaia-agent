# Database — Postgres + pgvector

## Schema

Las 13 tablas del Published Knowledge Layer + tablas de sistema (sync_versions, audit_log, kb_embeddings).

Estructura completa documentada en `../docs/PLANIFICACION_RAG.md` sección 11.

## Setup

### Producción (Contabo via Easypanel)

```bash
# Aplicar schema completo
psql "$DATABASE_URL" -f schema.sql

# Cargar datos del cliente piloto (Dr. Petro)
bash seed-petro.sh
```

### Dev local

```bash
# Levanta Postgres+pgvector con docker compose
cd ..
npm run db:up

# Aplica schema
npm run db:migrate
```

## Migraciones

Cualquier cambio al schema posterior al deploy inicial va en `migrations/` con nombre `NNN-descripcion.sql` y se aplica con orden numérico.
