// =============================================================================
// agent-message.js — Lógica core del agente IA.
// =============================================================================
// Función handleMessage({ clientId, contactId, contactName, channel, body })
// que recibe un mensaje del lead, recupera contexto del KB, llama al LLM y
// devuelve la respuesta. Persiste conversación + mensajes en Postgres con
// audit completo (chunks usados, tokens, latencia).
//
// Diseño:
//   - Retrieval híbrido:
//       (a) SQL: clients + client_branding + restrictions (siempre)
//                + services activos (siempre, para que el LLM tenga el catálogo)
//                + locations + schedules (siempre, contexto operacional)
//       (b) pgvector: top-K chunks por similitud al mensaje
//   - System prompt:  contrato + branding + restrictions + retrieved context
//   - Historial:      últimos N turnos de la conversación (default 10)
//   - LLM:            gpt-4o-mini, temperature 0.3
//
// Uso programático:
//   import { handleMessage } from './agent-message.js';
//   const r = await handleMessage({ clientId, contactId, body, ... });
//
// Uso CLI (one-shot):
//   node scripts/agent-message.js "¿cuánto cuesta el botox?"
//   (asume PILOT_CLIENT_ID, crea contacto temporal CLI-TEST)
// =============================================================================

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import OpenAI from 'openai';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LLM_MODEL = process.env.OPENAI_LLM_MODEL || 'gpt-4o-mini';
const EMBED_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const TOP_K_CHUNKS = 5;
const HISTORY_TURNS = 10;
const LLM_TEMP = 0.3;

let _pool = null;
function getPool() {
  if (_pool) return _pool;
  _pool = new Pool({
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    max: 5,
  });
  return _pool;
}

let _openai = null;
function getOpenAI() {
  if (_openai) return _openai;
  _openai = new OpenAI();
  return _openai;
}

// ─── Carga del Contrato de KB ──────────────────────────────────────────────
let _contractTemplate = null;
async function loadContract() {
  if (_contractTemplate) return _contractTemplate;
  const file = path.join(__dirname, '..', 'prompts', 'contrato-interpretacion-kb.md');
  const md = await fs.readFile(file, 'utf8');
  // Extraer solo el bloque entre ``` y ``` (el template, ignoramos las notas)
  const match = md.match(/```text\n([\s\S]+?)\n```/);
  _contractTemplate = match ? match[1] : md;
  return _contractTemplate;
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function fillTemplate(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));
}

function listFormat(arr) {
  if (!arr || !arr.length) return '(ninguna)';
  return arr.map((s, i) => `  ${i + 1}. ${s}`).join('\n');
}

// ─── Carga del contexto del cliente ───────────────────────────────────────
async function loadClientContext(pool, clientId) {
  const c = await pool.query(`SELECT * FROM clients WHERE id = $1`, [clientId]);
  if (!c.rowCount) throw new Error(`Cliente no existe: ${clientId}`);
  const client = c.rows[0];

  const b = await pool.query(`SELECT * FROM client_branding WHERE client_id = $1`, [clientId]);
  const branding = b.rows[0] || {};

  const r = await pool.query(
    `SELECT tipo, descripcion, severidad, mensaje_defleccion
       FROM restrictions
      WHERE client_id = $1
      ORDER BY severidad DESC NULLS LAST`,
    [clientId]
  );

  const s = await pool.query(
    `SELECT external_id, servicio, variante, tipo_precio, precio_servicio, moneda,
            requiere_valoracion, duracion_texto, aliases, tags
       FROM services
      WHERE client_id = $1 AND activo = TRUE
      ORDER BY servicio`,
    [clientId]
  );

  const l = await pool.query(
    `SELECT nombre, direccion, ciudad, telefono FROM locations
      WHERE client_id = $1 AND activo = TRUE ORDER BY nombre`,
    [clientId]
  );

  const sched = await pool.query(
    `SELECT dia_texto, hora_apertura, hora_cierre, abierto
       FROM schedules
      WHERE client_id = $1
      ORDER BY dia_semana`,
    [clientId]
  );

  return { client, branding, restrictions: r.rows, services: s.rows, locations: l.rows, schedules: sched.rows };
}

// ─── Retrieval semántico ───────────────────────────────────────────────────
async function retrieveChunks(pool, clientId, queryEmbedding, topK = TOP_K_CHUNKS) {
  const r = await pool.query(
    `SELECT source_table, source_external_id, source_field, content_text, metadata,
            1 - (embedding <=> $1::vector) AS similarity
       FROM kb_chunks
      WHERE client_id = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [`[${queryEmbedding.join(',')}]`, clientId, topK]
  );
  return r.rows;
}

// ─── Conversation management ──────────────────────────────────────────────
async function findOrCreateConversation(pool, clientId, contactId, channel) {
  const found = await pool.query(
    `SELECT * FROM conversations
      WHERE client_id = $1 AND ghl_contact_id = $2 AND status = 'active'
      ORDER BY started_at DESC LIMIT 1`,
    [clientId, contactId]
  );
  if (found.rowCount) return found.rows[0];

  const created = await pool.query(
    `INSERT INTO conversations (client_id, ghl_contact_id, channel, status)
     VALUES ($1, $2, $3, 'active') RETURNING *`,
    [clientId, contactId, channel || 'unknown']
  );
  return created.rows[0];
}

async function loadHistory(pool, conversationId, limit = HISTORY_TURNS) {
  const r = await pool.query(
    `SELECT role, content
       FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
      LIMIT $2`,
    [conversationId, limit * 2] // 2 mensajes por turno (user + assistant)
  );
  return r.rows;
}

// ─── Armado del system prompt ──────────────────────────────────────────────
async function buildSystemPrompt(ctx, retrieved, leadName) {
  const tpl = await loadContract();

  // Resumen catálogo (lista corta para que el LLM lo tenga in-context)
  const serviciosLines = ctx.services.map((s) => {
    const precio = s.precio_servicio ? `${s.tipo_precio || ''} ${Number(s.precio_servicio).toLocaleString('es-CO')} ${s.moneda || ''}`.trim() : '(sin precio en KB)';
    const variante = s.variante ? ` — ${s.variante}` : '';
    const val = s.requiere_valoracion ? ' (requiere valoración)' : '';
    return `  - [${s.external_id}] ${s.servicio}${variante}: ${precio}${val}`;
  }).join('\n') || '  (sin servicios activos)';

  const sedesLines = ctx.locations.map((l) =>
    `  - ${l.nombre}: ${l.direccion || ''}, ${l.ciudad || ''}${l.telefono ? ' · tel: ' + l.telefono : ''}`
  ).join('\n') || '  (sin sedes activas)';

  const horariosLines = ctx.schedules.map((s) =>
    `  - ${s.dia_texto}: ${s.abierto ? `${s.hora_apertura || '?'} a ${s.hora_cierre || '?'}` : 'cerrado'}`
  ).join('\n') || '  (sin horarios cargados)';

  const restriccionesLines = listFormat(ctx.restrictions.map((r) => `[${r.tipo}] ${r.descripcion}`));

  const retrievedLines = retrieved.length
    ? retrieved.map((c, i) =>
        `  [${i + 1}] (${c.source_table}/${c.source_external_id}/${c.source_field}, sim=${c.similarity.toFixed(3)})\n      ${String(c.content_text).replace(/\n/g, ' ').slice(0, 400)}`
      ).join('\n')
    : '  (sin chunks relevantes — si el lead pide info que no está en SERVICIOS/SEDES/HORARIOS, decir "no tengo ese dato confirmado")';

  const vars = {
    nombre_agente: ctx.branding.nombre_agente || 'asistente',
    business_name: ctx.client.business_name,
    vertical: ctx.client.vertical,
    lead_channels: '(varios)',
    tono: ctx.branding.tono || 'profesional y cercano',
    formalidad: ctx.branding.formalidad || 'semi-formal',
    tratamiento: ctx.branding.tratamiento || 'TU',
    uso_emojis: ctx.branding.uso_emojis || 'ocasional',
    longitud: ctx.branding.longitud || 'corto',
    propuesta_valor: ctx.branding.propuesta_valor || '',
    valores: (ctx.branding.valores || []).join(', '),
    tagline: ctx.branding.tagline || '',
    restrictions_list: restriccionesLines,
    forbidden_phrases_list: '(ver tabla de restricciones arriba — extender en sync futuro)',
    sensitive_topics_list: '(ver tabla de restricciones arriba)',
    can_share_prices: '(según política del cliente — por defecto "desde")',
    discount_policy: '(según política — por defecto no se ofrecen descuentos espontáneos)',
    no_show_policy: '(según política — confirmar al agendar)',
    retrieved_context: `SERVICIOS ACTIVOS:\n${serviciosLines}\n\nSEDES:\n${sedesLines}\n\nHORARIOS:\n${horariosLines}\n\nCHUNKS RELEVANTES (búsqueda semántica):\n${retrievedLines}`,
    conversation_history: '(en mensajes a continuación)',
    lead_name: leadName || '(sin nombre)',
  };

  return fillTemplate(tpl, vars);
}

// ─── Función principal ─────────────────────────────────────────────────────
export async function handleMessage({ clientId, contactId, contactName, channel, body, persist = true }) {
  if (!clientId || !contactId || !body) {
    throw new Error('handleMessage requiere clientId, contactId, body');
  }

  const pool = getPool();
  const openai = getOpenAI();
  const t0 = Date.now();

  // 1. Cargar contexto del cliente
  const ctx = await loadClientContext(pool, clientId);

  // 2. Conversación + historial
  const conv = persist ? await findOrCreateConversation(pool, clientId, contactId, channel) : { id: null };
  const history = conv.id ? await loadHistory(pool, conv.id) : [];

  // 3. Embedding del mensaje + retrieval semántico
  const tEmb = Date.now();
  const embResp = await openai.embeddings.create({ model: EMBED_MODEL, input: body });
  const vec = embResp.data[0].embedding;
  const retrieved = await retrieveChunks(pool, clientId, vec, TOP_K_CHUNKS);
  const tEmbedMs = Date.now() - tEmb;

  // 4. System prompt
  const system = await buildSystemPrompt(ctx, retrieved, contactName);

  // 5. LLM call
  const tLlm = Date.now();
  const messages = [
    { role: 'system', content: system },
    ...history.map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })),
    { role: 'user', content: body },
  ];

  const completion = await openai.chat.completions.create({
    model: LLM_MODEL,
    temperature: LLM_TEMP,
    messages,
  });

  const reply = completion.choices[0].message.content || '';
  const tLlmMs = Date.now() - tLlm;
  const totalMs = Date.now() - t0;
  const tokensIn = completion.usage?.prompt_tokens || 0;
  const tokensOut = completion.usage?.completion_tokens || 0;

  // 6. Persistir mensajes
  if (persist && conv.id) {
    await pool.query(
      `INSERT INTO messages (conversation_id, client_id, role, content, model_used, tokens_in, tokens_out, latency_ms)
       VALUES ($1, $2, 'user', $3, NULL, NULL, NULL, NULL)`,
      [conv.id, clientId, body]
    );
    await pool.query(
      `INSERT INTO messages (
         conversation_id, client_id, role, content, chunks_retrieved,
         model_used, tokens_in, tokens_out, latency_ms
       ) VALUES ($1, $2, 'assistant', $3, $4, $5, $6, $7, $8)`,
      [
        conv.id, clientId, reply,
        JSON.stringify(retrieved.map((c) => ({
          source_table: c.source_table, source_external_id: c.source_external_id,
          source_field: c.source_field, similarity: c.similarity,
        }))),
        LLM_MODEL, tokensIn, tokensOut, totalMs,
      ]
    );
  }

  return {
    reply,
    conversationId: conv.id,
    metadata: {
      modelUsed: LLM_MODEL,
      tokensIn,
      tokensOut,
      latencyMs: totalMs,
      embedMs: tEmbedMs,
      llmMs: tLlmMs,
      chunksRetrieved: retrieved.map((c) => ({
        ref: `${c.source_table}/${c.source_external_id}/${c.source_field}`,
        sim: c.similarity,
      })),
    },
  };
}

// ─── CLI (one-shot) ────────────────────────────────────────────────────────
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const body = process.argv.slice(2).join(' ').trim();
  if (!body) {
    console.error('Uso: node scripts/agent-message.js "<mensaje del lead>"');
    process.exit(1);
  }

  const clientId = process.env.PILOT_CLIENT_ID;
  if (!clientId) {
    console.error('Falta PILOT_CLIENT_ID en .env');
    process.exit(1);
  }

  try {
    const r = await handleMessage({
      clientId,
      contactId: 'CLI-TEST',
      contactName: 'Lead Prueba',
      channel: 'cli',
      body,
      persist: false, // CLI one-shot no persiste
    });
    console.log('\n─── RESPUESTA DEL AGENTE ───────────────────────────────');
    console.log(r.reply);
    console.log('─── METADATA ──────────────────────────────────────────');
    console.log(`modelo: ${r.metadata.modelUsed}`);
    console.log(`tokens: ${r.metadata.tokensIn} → ${r.metadata.tokensOut}`);
    console.log(`latencia: ${r.metadata.latencyMs}ms (embed ${r.metadata.embedMs}ms · llm ${r.metadata.llmMs}ms)`);
    console.log('chunks usados:');
    r.metadata.chunksRetrieved.forEach((c, i) => console.log(`  ${i + 1}. ${c.ref} (sim ${c.sim.toFixed(3)})`));
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    if (_pool) await _pool.end();
  }
}
