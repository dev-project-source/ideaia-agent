// =============================================================================
// agent-server.js — HTTP server que expone handleMessage() via REST.
// =============================================================================
// Endpoint:
//   POST /handle-message
//     body: {
//       clientId:    UUID del cliente (default PILOT_CLIENT_ID si falta)
//       contactId:   string (GHL contact id o equivalente — único por lead)
//       contactName: string opcional
//       channel:     'whatsapp' | 'instagram' | 'web' | 'sms' | etc.
//       body:        string (el mensaje del lead)
//     }
//     response: {
//       reply: string,
//       conversationId: UUID,
//       metadata: { modelUsed, tokensIn, tokensOut, latencyMs, chunksRetrieved }
//     }
//
//   GET /health
//     response: { ok: true, uptime, model, embedModel }
//
// Diseño:
//   - Single-process Express. Mantiene 1 Pool de Postgres + 1 cliente OpenAI.
//   - Sin auth en MVP. Atrás vive solo en la red Docker interna del server,
//     n8n es el único que lo llama. Si en el futuro se expone al world se le
//     agrega un middleware con bearer token.
//   - 5xx solo si falla la infra. Errores de validación → 400 con detalle.
// =============================================================================

import 'dotenv/config';
import express from 'express';
import { handleMessage } from './agent-message.js';
import { runKbSync } from './kb-sync.js';

// Flag para evitar que 2 syncs corran a la vez sobre el mismo cliente
const syncsInProgress = new Set();

const PORT = parseInt(process.env.AGENT_API_PORT || '3000', 10);
const STARTED_AT = Date.now();

const app = express();
app.use(express.json({ limit: '256kb' }));

// ─── Health ────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptime_s: Math.round((Date.now() - STARTED_AT) / 1000),
    model: process.env.OPENAI_LLM_MODEL || 'gpt-4o-mini',
    embedModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  });
});

// ─── Handle inbound message ────────────────────────────────────────────────
app.post('/handle-message', async (req, res) => {
  const t0 = Date.now();
  try {
    const {
      clientId = process.env.PILOT_CLIENT_ID,
      contactId,
      contactName = null,
      channel = 'unknown',
      body,
    } = req.body || {};

    if (!clientId) return res.status(400).json({ error: 'clientId requerido (o seteá PILOT_CLIENT_ID)' });
    if (!contactId) return res.status(400).json({ error: 'contactId requerido' });
    if (!body || typeof body !== 'string') return res.status(400).json({ error: 'body (string) requerido' });

    const r = await handleMessage({ clientId, contactId, contactName, channel, body });

    console.log(
      `[${new Date().toISOString()}] ${contactId} · ${channel} · ${r.metadata.latencyMs}ms ` +
      `· ${r.metadata.tokensIn}→${r.metadata.tokensOut} tok · "${body.slice(0, 50)}..."`
    );

    res.json({
      reply: r.reply,
      conversationId: r.conversationId,
      metadata: r.metadata,
    });
  } catch (e) {
    console.error(`[ERROR] ${e.message}\n${e.stack}`);
    res.status(500).json({ error: e.message });
  }
});

// ─── KB Sync (cron disparado por n8n) ──────────────────────────────────────
// POST /kb-sync/:clientId
//   body: { force?: boolean } (opcional, fuerza sync aunque el sheet no haya cambiado)
//
// Si el sheet del cliente cambió desde el último sync, re-ejecuta first-activation.
// Idempotente: si se llama 2 veces seguidas y no hubo cambios, la segunda
// devuelve { skipped: true }.
// Protección: si hay un sync en curso para el mismo cliente, devuelve 409.
app.post('/kb-sync/:clientId', async (req, res) => {
  const { clientId } = req.params;
  const force = req.body?.force === true;

  if (!clientId) return res.status(400).json({ error: 'clientId requerido' });
  if (syncsInProgress.has(clientId)) {
    return res.status(409).json({ error: 'sync ya en curso para ese cliente' });
  }

  syncsInProgress.add(clientId);
  const t0 = Date.now();
  try {
    const result = await runKbSync({ clientId, force });
    console.log(
      `[${new Date().toISOString()}] kb-sync ${clientId.slice(0, 8)} · ` +
      `${result.ok ? (result.skipped ? 'skipped' : 'synced') : 'failed'} · ${Date.now() - t0}ms`
    );
    res.json(result);
  } catch (e) {
    console.error('[kb-sync ERROR]', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    syncsInProgress.delete(clientId);
  }
});

// ─── Catch-all 404 ─────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// ─── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] agent-server escuchando en :${PORT}`);
  console.log(`  PILOT_CLIENT_ID = ${process.env.PILOT_CLIENT_ID || '(no seteado — debe venir en cada request)'}`);
  console.log(`  PG_HOST         = ${process.env.PG_HOST}`);
  console.log(`  LLM             = ${process.env.OPENAI_LLM_MODEL || 'gpt-4o-mini'}`);
});

// Graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[${new Date().toISOString()}] recibí ${sig}, cerrando…`);
    process.exit(0);
  });
}
