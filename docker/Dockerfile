# =============================================================================
# IDEA IA · agent-api · Imagen del HTTP server que expone handleMessage()
# =============================================================================
# Usado por el workflow n8n para responder mensajes inbound de GHL.
# Build:   docker build -t ideaia-agent-api -f docker/Dockerfile .
# Run:     docker compose -f docker/docker-compose.server.yml up -d agent-api
# =============================================================================

FROM node:20-alpine AS base
WORKDIR /app

# Deps en una capa cacheada
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Código de la app
COPY scripts/agent-message.js   scripts/agent-message.js
COPY scripts/agent-server.js    scripts/agent-server.js
COPY scripts/chunking.js        scripts/chunking.js
COPY prompts/                   prompts/

ENV NODE_ENV=production
ENV AGENT_API_PORT=3000
EXPOSE 3000

# Healthcheck — Docker reinicia el container si el endpoint falla
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "scripts/agent-server.js"]
