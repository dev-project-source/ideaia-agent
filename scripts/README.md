# scripts/

Scripts auxiliares del agente.

## `setup-day1.sh`

Setup inicial del server Contabo. Instala Docker + Compose, configura UFW, levanta los 3 containers (postgres-agent con pgvector, postgres-n8n, n8n).

**Idempotente**: se puede correr varias veces sin romper nada. Si el `.env` ya existe, no lo regenera (preserva passwords).

**Uso:**

```bash
# Desde tu Windows local
scp scripts/setup-day1.sh root@45.13.59.95:/root/
ssh root@45.13.59.95 'bash /root/setup-day1.sh'
```

Después del script, n8n queda accesible en `http://45.13.59.95:5678`.
