# n8n Workflows

Los workflows del agente RAG, exportados como JSON desde n8n para versionarse en git.

## Workflows

| Archivo | Propósito | Trigger |
|---|---|---|
| `01-client-first-activation.json` | Lee el Sheet del cliente, valida, popula Postgres + genera embeddings | Webhook (desde `ideaia-onboarding` al completar onboarding) |
| `02-kb-sync-cron.json` | Detecta cambios en el Sheet y propaga a Postgres/pgvector | Cron cada 15 min |
| `03-message-handler.json` | Recibe mensaje de un lead, clasifica intent, recupera contexto, genera respuesta | Webhook (desde GHL) |

## Cómo importar

1. En n8n: **Workflows → Import from File**
2. Seleccionar el `.json`
3. Configurar credenciales del workflow (variables que apuntan a Postgres, OpenAI, Redis, GHL — ver `.env.example` del repo)
4. Activar el workflow

## Cómo exportar (para versionar cambios)

1. En n8n: abrir el workflow → menú **... → Download**
2. Guardar acá con el mismo nombre
3. Commit
