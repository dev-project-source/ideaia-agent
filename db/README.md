# db/

Postgres schema + migraciones del agente.

## `schema.sql`

Schema completo, idempotente (`CREATE ... IF NOT EXISTS` en todo). 20 tablas:

**Knowledge Layer** (14 tablas, una por pestaña editable del Sheet):
1. `clients` — multi-tenant root
2. `client_branding` — ADN_MARCA + ESTILO_RESPUESTA
3. `services` — catálogo unificado
4. `service_descriptions` — textos largos por servicio
5. `promotions`
6. `schedules` — horarios regulares
7. `schedule_exceptions` — festivos + ad-hoc
8. `locations` — sedes
9. `faqs`
10. `objections`
11. `team_contacts`
12. `escalations`
13. `restrictions`
14. `reengagement_sequences`

**Vector Layer**:
15. `kb_chunks` — chunks con `embedding VECTOR(1536)` + índice HNSW cosine

**Runtime / Audit**:
16. `agent_params` — parámetros operacionales key-value
17. `conversations`
18. `messages`
19. `audit_log`
20. `sync_runs`

## Aplicar al server

Desde el repo en Windows:

```cmd
ssh root@45.13.59.95 "docker exec -i ideaia-postgres-agent psql -U ideaia -d ideaia_agent -v ON_ERROR_STOP=1" < db\schema.sql
```

Verificar con:

```cmd
ssh root@45.13.59.95 "docker exec ideaia-postgres-agent psql -U ideaia -d ideaia_agent -c '\dt'"
```

Debería listar las 20 tablas.

## Migraciones

Cualquier cambio al schema posterior al deploy inicial va en `migrations/` con nombre `NNN-descripcion.sql` y se aplica con orden numérico.
