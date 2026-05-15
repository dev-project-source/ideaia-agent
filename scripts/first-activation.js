#!/usr/bin/env node
// =============================================================================
// First Activation: lee el Sheet de un cliente → llena Postgres → embeddings
// =============================================================================
// Se corre 1 vez por cliente, manualmente, después del onboarding.
// Idempotente: usa sync_version para detectar filas obsoletas.
//
// Uso:
//   node scripts/first-activation.js
//
// Requiere en .env:
//   PILOT_CLIENT_ID, PILOT_SHEET_ID
//   PG_HOST=localhost (con SSH tunnel) o IP directa (con tunnel cerrado)
//   PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE
//   GOOGLE_SERVICE_ACCOUNT_KEY (base64), OPENAI_API_KEY
// =============================================================================

import 'dotenv/config';
import { google } from 'googleapis';
import pg from 'pg';
import OpenAI from 'openai';
import { chunkRows } from './chunking.js';

const { Pool } = pg;

// ─── Config ─────────────────────────────────────────────────────────────────
const CLIENT_ID = process.env.PILOT_CLIENT_ID;
const SHEET_ID = process.env.PILOT_SHEET_ID;
const EMBED_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBED_DIM = 1536;
const BATCH_EMBED_SIZE = 100;

if (!CLIENT_ID || !SHEET_ID) {
  console.error('FAIL: PILOT_CLIENT_ID y PILOT_SHEET_ID requeridos en .env');
  process.exit(1);
}

// ─── Helpers de logging ────────────────────────────────────────────────────
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.log(`  ⚠ ${msg}`);

// ─── Auth Google ───────────────────────────────────────────────────────────
function getGoogleAuth() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!b64) throw new Error('Falta GOOGLE_SERVICE_ACCOUNT_KEY (base64) en .env');
  const credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

// ─── Lectura del Sheet ──────────────────────────────────────────────────────
// Lee TODAS las pestañas en un solo batchGet. Devuelve { tabName: rows[][] }
async function readAllTabs(sheetsApi) {
  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties.title' });
  const tabNames = meta.data.sheets.map((s) => s.properties.title);
  log(`Sheet tiene ${tabNames.length} pestañas: ${tabNames.join(', ')}`);

  const res = await sheetsApi.spreadsheets.values.batchGet({
    spreadsheetId: SHEET_ID,
    ranges: tabNames.map((n) => `'${n}'`),
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const out = {};
  for (let i = 0; i < tabNames.length; i++) {
    out[tabNames[i]] = res.data.valueRanges[i].values || [];
  }
  return out;
}

// ─── Helpers genéricos de parsing ──────────────────────────────────────────
// Convierte filas [header, ...rows] a array de objetos {header: value}
function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map((h) => String(h || '').trim());
  return rows
    .slice(1)
    .filter((r) => r.some((cell) => String(cell || '').trim() !== ''))
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = r[i] !== undefined && r[i] !== null ? String(r[i]).trim() : '';
      });
      return obj;
    });
}

const splitList = (v) =>
  !v ? [] : String(v).split(/[,;|]/).map((s) => s.trim()).filter(Boolean);

const toBool = (v) => {
  if (v === true || v === false) return v;
  const s = String(v || '').toUpperCase().trim();
  return s === 'TRUE' || s === 'SI' || s === 'YES' || s === 'SÍ' || s === '1';
};

const toIntOrNull = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

const toNumOrNull = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[$.\s]/g, '').replace(/,/g, '.'));
  return Number.isFinite(n) ? n : null;
};

// Para HORARIOS: convierte "lunes" → 1, "domingo" → 7 (NULL si es fecha festivo)
const DIA_TO_INT = {
  lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6, domingo: 7,
};
const diaToInt = (v) => DIA_TO_INT[String(v || '').toLowerCase().trim()] ?? null;

// Detecta si una celda `dia` es una fecha (sección B de HORARIOS)
const isDateString = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim());

// ─── Postgres helpers ──────────────────────────────────────────────────────
async function startSyncRun(pool, syncVersion) {
  const r = await pool.query(
    `INSERT INTO sync_runs (client_id, trigger_type, sync_version, status)
     VALUES ($1, 'first_activation', $2, 'running')
     RETURNING id`,
    [CLIENT_ID, syncVersion]
  );
  return r.rows[0].id;
}

async function finishSyncRun(pool, runId, status, payload) {
  await pool.query(
    `UPDATE sync_runs
     SET finished_at = now(), status = $2,
         rows_upserted = $3, chunks_generated = $4,
         embeddings_generated = $5, errors = $6,
         duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000
     WHERE id = $1`,
    [runId, status, payload.rows_upserted || {}, payload.chunks_generated || 0,
     payload.embeddings_generated || 0, JSON.stringify(payload.errors || [])]
  );
}

async function nextSyncVersion(pool) {
  const r = await pool.query('SELECT current_sync_version FROM clients WHERE id = $1', [CLIENT_ID]);
  if (!r.rowCount) throw new Error(`No existe cliente con id ${CLIENT_ID}`);
  return (r.rows[0].current_sync_version || 0) + 1;
}

async function bumpClientSyncVersion(pool, newVersion) {
  await pool.query(
    `UPDATE clients SET current_sync_version = $2, last_sync_at = now(), last_sync_status = 'ok' WHERE id = $1`,
    [CLIENT_ID, newVersion]
  );
}

// Genérico: upsert array de filas en una tabla. cols es array de nombres,
// extractor es función que devuelve [values...] en el mismo orden de cols.
async function upsertRows(pool, table, cols, conflictCol, extractor, rows, syncVersion) {
  if (!rows.length) return 0;
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const updates = cols.filter((c) => c !== conflictCol && c !== 'client_id')
    .map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
               ON CONFLICT (client_id, ${conflictCol}) DO UPDATE SET ${updates}`;

  let count = 0;
  for (const r of rows) {
    try {
      const vals = extractor(r, syncVersion);
      await pool.query(sql, vals);
      count++;
    } catch (e) {
      warn(`upsert ${table} fallo en fila: ${e.message}`);
    }
  }
  return count;
}

// ─── Parsers + Upserts por pestaña ────────────────────────────────────────

async function syncKbConfig(pool, rows) {
  // KB_CONFIG es key-value vertical. Actualizamos campos relevantes de `clients`.
  const objs = rowsToObjects(rows);
  const kv = {};
  for (const o of objs) {
    const key = String(o.config_key || '').toLowerCase().trim();
    if (key) kv[key] = o.config_value;
  }
  const updates = {};
  if (kv.business_name) updates.business_name = kv.business_name;
  if (kv.timezone) updates.timezone = kv.timezone;
  if (kv.ghl_calendar_id) updates.ghl_calendar_id = kv.ghl_calendar_id;

  if (!Object.keys(updates).length) return 0;
  const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
  await pool.query(`UPDATE clients SET ${sets}, updated_at = now() WHERE id = $1`, [CLIENT_ID, ...Object.values(updates)]);
  return 1;
}

async function syncAdnAndEstilo(pool, adnRows, estiloRows, syncVersion) {
  // ADN_MARCA: { elemento, valor } → flat
  const adn = {};
  for (const o of rowsToObjects(adnRows)) {
    const key = String(o.elemento || '').toLowerCase().trim();
    if (key) adn[key] = o.valor;
  }
  // ESTILO_RESPUESTA: { parametro, valor } → flat
  const est = {};
  for (const o of rowsToObjects(estiloRows)) {
    const key = String(o.parametro || '').toLowerCase().trim();
    if (key) est[key] = o.valor;
  }

  await pool.query(
    `INSERT INTO client_branding (
       client_id, nombre_agente, tagline, propuesta_valor, tono, valores,
       formalidad, uso_emojis, longitud, idioma, tratamiento, extras, sync_version
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (client_id) DO UPDATE SET
       nombre_agente = EXCLUDED.nombre_agente,
       tagline = EXCLUDED.tagline,
       propuesta_valor = EXCLUDED.propuesta_valor,
       tono = EXCLUDED.tono,
       valores = EXCLUDED.valores,
       formalidad = EXCLUDED.formalidad,
       uso_emojis = EXCLUDED.uso_emojis,
       longitud = EXCLUDED.longitud,
       idioma = EXCLUDED.idioma,
       tratamiento = EXCLUDED.tratamiento,
       extras = EXCLUDED.extras,
       sync_version = EXCLUDED.sync_version`,
    [
      CLIENT_ID,
      adn.nombre_agente || null,
      adn.tagline || null,
      adn.propuesta_valor || null,
      adn.tono_comunicacion || adn.tono || null,
      splitList(adn.valores_marca || adn.valores),
      est.formalidad || null,
      est.uso_emojis || null,
      est.longitud_respuesta || est.longitud || null,
      est.idioma_respuesta || est.idioma || null,
      est.tratamiento || null,
      JSON.stringify({ adn_extra: { ...adn }, estilo_extra: { ...est } }),
      syncVersion,
    ]
  );
  return 1;
}

async function syncServices(pool, rows, syncVersion) {
  const objs = rowsToObjects(rows);
  return upsertRows(pool, 'services', [
    'client_id', 'external_id', 'procedimiento_referencia', 'categoria', 'servicio', 'variante',
    'requiere_valoracion', 'tipo_precio', 'precio_servicio', 'precio_usd', 'precio_valoracion',
    'moneda', 'aliases', 'tags', 'duracion_texto', 'notas_internas', 'activo', 'sync_version',
  ], 'external_id', (o, v) => [
    CLIENT_ID,
    o.service_id,
    o.procedimiento_referencia || null,
    o.categoria || null,
    o.servicio,
    o.variante || null,
    toBool(o.requiere_valoracion),
    o.tipo_precio || null,
    toNumOrNull(o.precio_servicio),
    toNumOrNull(o.precio_usd),
    toNumOrNull(o.precio_valoracion),
    o.moneda || 'COP',
    splitList(o.aliases),
    splitList(o.tags),
    o.duracion || null,
    o.notas_internas || null,
    toBool(o.activo),
    v,
  ], objs, syncVersion);
}

async function syncDescriptions(pool, rows, syncVersion) {
  const objs = rowsToObjects(rows);
  return upsertRows(pool, 'service_descriptions', [
    'client_id', 'external_id', 'nombre_servicio', 'que_es', 'para_quien', 'protocolo',
    'duracion_tipica', 'indicaciones_previas', 'cuidados_posteriores', 'contraindicaciones',
    'resultados', 'faq', 'notas_importantes', 'sync_version',
  ], 'external_id', (o, v) => [
    CLIENT_ID,
    o.service_id,
    o.nombre_servicio || null,
    o.que_es || null,
    o.para_quien || null,
    o.que_incluye_protocolo || null,
    o.duracion_tipica || null,
    o.indicaciones_previas || null,
    o.cuidados_posteriores || null,
    o.contraindicaciones || null,
    o.resultados_esperados || null,
    o.preguntas_frecuentes || null,
    o.notas_importantes || null,
    v,
  ], objs, syncVersion);
}

async function syncPromotions(pool, rows, syncVersion) {
  const objs = rowsToObjects(rows);
  return upsertRows(pool, 'promotions', [
    'client_id', 'external_id', 'titulo', 'descripcion', 'tipo_descuento', 'valor_descuento',
    'mensaje_promo', 'servicios_aplicables', 'fecha_inicio', 'fecha_fin', 'condiciones',
    'estado', 'activo', 'sync_version',
  ], 'external_id', (o, v) => [
    CLIENT_ID,
    o.promo_id,
    o.nombre,
    o.descripcion || null,
    o.tipo_descuento || null,
    o.valor || null,
    o.mensaje_promo || null,
    splitList(o.servicios_aplicables),
    o.fecha_inicio || null,
    o.fecha_fin || null,
    o.condiciones || null,
    o.estado || 'activa',
    toBool(o.activo),
    v,
  ], objs, syncVersion);
}

async function syncHorarios(pool, rows, syncVersion) {
  // HORARIOS tiene 2 secciones. Iteramos: si `dia` es nombre de día → schedules;
  // si es YYYY-MM-DD → schedule_exceptions.
  const objs = rowsToObjects(rows);
  let schedCount = 0;
  let exceptCount = 0;
  let extId = 1;

  for (const o of objs) {
    const dia = String(o.dia || '').trim();
    if (!dia || dia.startsWith('──')) continue;

    if (isDateString(dia)) {
      // Sección B: festivo o excepción
      await pool.query(
        `INSERT INTO schedule_exceptions (
           client_id, external_id, fecha, tipo, descripcion, notas, sede_id, origen, sync_version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          CLIENT_ID,
          `HRE_${String(extId++).padStart(3, '0')}`,
          dia,
          toBool(o.activo) ? 'horario_especial' : 'cerrado',
          o.notas || null,
          o.notas || null,
          o.sede_id || null,
          (o.notas || '').toLowerCase().includes('festivo') ? 'festivo_pais' : 'manual',
          syncVersion,
        ]
      );
      exceptCount++;
    } else {
      // Sección A: horario regular
      const diaInt = diaToInt(dia);
      if (!diaInt) continue;
      await pool.query(
        `INSERT INTO schedules (
           client_id, external_id, dia_semana, dia_texto, hora_apertura, hora_cierre,
           abierto, notas, sede_id, sync_version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (client_id, external_id) DO UPDATE SET
           hora_apertura = EXCLUDED.hora_apertura, hora_cierre = EXCLUDED.hora_cierre,
           abierto = EXCLUDED.abierto, notas = EXCLUDED.notas, sync_version = EXCLUDED.sync_version`,
        [
          CLIENT_ID,
          `HR_${String(diaInt).padStart(3, '0')}`,
          diaInt,
          dia,
          o.hora_apertura || null,
          o.hora_cierre || null,
          toBool(o.activo),
          o.notas || null,
          o.sede_id || null,
          syncVersion,
        ]
      );
      schedCount++;
    }
  }
  return { schedules: schedCount, schedule_exceptions: exceptCount };
}

async function syncLocations(pool, rows, syncVersion) {
  const objs = rowsToObjects(rows);
  return upsertRows(pool, 'locations', [
    'client_id', 'external_id', 'nombre', 'direccion', 'ciudad', 'pais', 'telefono',
    'servicios_disponibles', 'horarios_propios', 'indicaciones_acceso', 'activo', 'sync_version',
  ], 'external_id', (o, v) => [
    CLIENT_ID,
    o.location_id,
    o.nombre,
    o.direccion || null,
    o.ciudad || null,
    o.pais || null,
    o.telefono || null,
    splitList(o.servicios_disponibles),
    o.horarios_propios || null,
    o.indicaciones_acceso || null,
    toBool(o.activo),
    v,
  ], objs, syncVersion);
}

async function syncFaqs(pool, rows, syncVersion) {
  const objs = rowsToObjects(rows);
  // Sheet usa 1 fila por variante. Vamos a guardar cada fila como FAQ propio
  // (con `pregunta_variante` como la pregunta específica) y dejamos que el
  // retrieval semántico agrupe por intent_tag a nivel queries.
  return upsertRows(pool, 'faqs', [
    'client_id', 'external_id', 'intent_tag', 'pregunta_principal', 'pregunta_variante',
    'variantes_pregunta', 'respuesta', 'accion_siguiente', 'aplica_a_vertical', 'fuente',
    'prioridad', 'sync_version',
  ], 'external_id', (o, v) => [
    CLIENT_ID,
    o.faq_id,
    o.intent_tag || 'general',
    o.pregunta_variante,
    o.pregunta_variante,
    [],
    o.respuesta_completa,
    o.accion_siguiente || null,
    o.aplica_a_vertical || null,
    o.fuente || null,
    toIntOrNull(o.prioridad),
    v,
  ], objs, syncVersion);
}

async function syncObjections(pool, rows, syncVersion) {
  const objs = rowsToObjects(rows);
  return upsertRows(pool, 'objections', [
    'client_id', 'external_id', 'categoria', 'frase_trigger', 'variantes_trigger',
    'respuesta_principal', 'respuesta_seguimiento', 'cierre_sugerido', 'accion_siguiente',
    'fuente', 'sync_version',
  ], 'external_id', (o, v) => [
    CLIENT_ID,
    o.obj_id,
    o.categoria || null,
    o.frase_trigger,
    [],
    o.respuesta_principal,
    o.respuesta_seguimiento || null,
    o.cierre_sugerido || null,
    o.accion_siguiente || null,
    o.fuente || null,
    v,
  ], objs, syncVersion);
}

async function syncTeamContacts(pool, rows, syncVersion) {
  const objs = rowsToObjects(rows);
  return upsertRows(pool, 'team_contacts', [
    'client_id', 'external_id', 'nombre', 'rol', 'canal_preferido', 'contacto',
    'disponibilidad', 'casos_que_atiende', 'prioridad_escalacion', 'activo', 'sync_version',
  ], 'external_id', (o, v) => [
    CLIENT_ID,
    o.contacto_id,
    o.nombre,
    o.rol || null,
    o.canal_preferido || null,
    o.contacto || null,
    o.disponibilidad || null,
    o.casos_que_atiende || null,
    toIntOrNull(o.prioridad_escalacion) ?? 99,
    toBool(o.activo),
    v,
  ], objs, syncVersion);
}

async function syncEscalations(pool, rows, syncVersion) {
  const objs = rowsToObjects(rows);
  return upsertRows(pool, 'escalations', [
    'client_id', 'external_id', 'trigger', 'trigger_tipo', 'trigger_descripcion',
    'trigger_valor', 'umbral_intentos', 'mensaje_handoff', 'destino', 'urgencia', 'sync_version',
  ], 'external_id', (o, v) => [
    CLIENT_ID,
    o.regla_id,
    o.trigger_descripcion || o.trigger_tipo, // legacy column (no-NULL)
    o.trigger_tipo || null,
    o.trigger_descripcion || null,
    o.trigger_valor || null,
    toIntOrNull(o.umbral_intentos),
    o.mensaje_handoff || null,
    o.destino_escalacion || null,
    o.urgencia || null,
    v,
  ], objs, syncVersion);
}

async function syncRestrictions(pool, rows, syncVersion) {
  const objs = rowsToObjects(rows);
  return upsertRows(pool, 'restrictions', [
    'client_id', 'external_id', 'tipo', 'descripcion', 'severidad', 'mensaje_defleccion',
    'razon', 'aplica_a_agente', 'sync_version',
  ], 'external_id', (o, v) => [
    CLIENT_ID,
    o.restriccion_id,
    o.tipo || 'otro',
    o.descripcion,
    'alta', // sheet no tiene severidad — default alta
    o.mensaje_defleccion || null,
    o.razon || null,
    o.aplica_a_agente || null,
    v,
  ], objs, syncVersion);
}

async function syncReengagement(pool, rows, syncVersion) {
  const objs = rowsToObjects(rows);
  return upsertRows(pool, 'reengagement_sequences', [
    'client_id', 'external_id', 'nombre_secuencia', 'trigger', 'trigger_evento',
    'dias_desde_contacto', 'mensaje_1', 'delay_1_horas', 'mensaje_2', 'delay_2_horas',
    'mensaje_3', 'delay_3_horas', 'accion_sin_respuesta', 'activo', 'sync_version',
  ], 'external_id', (o, v) => [
    CLIENT_ID,
    o.seq_id,
    o.nombre_secuencia || null,
    o.trigger_evento || 'trigger',
    o.trigger_evento || null,
    toIntOrNull(o.dias_desde_contacto),
    o.mensaje_1 || null,
    null,
    o.mensaje_2 || null,
    toIntOrNull(o.delay_mensaje_2) ? toIntOrNull(o.delay_mensaje_2) * 24 : null,
    o.mensaje_3 || null,
    toIntOrNull(o.delay_mensaje_3) ? toIntOrNull(o.delay_mensaje_3) * 24 : null,
    o.accion_sin_respuesta || null,
    toBool(o.activo),
    v,
  ], objs, syncVersion);
}

async function syncAgentParams(pool, rows, syncVersion) {
  const objs = rowsToObjects(rows);
  // PARAMETROS_AGENTES: key-value. UNIQUE es (client_id, parametro) — pero ahora
  // hay columna `agente` (un parámetro puede repetirse por agente). Por ahora
  // concatenamos agente|parametro como la clave del upsert.
  let count = 0;
  for (const o of objs) {
    if (!o.parametro) continue;
    const key = o.agente ? `${o.agente}|${o.parametro}` : o.parametro;
    await pool.query(
      `INSERT INTO agent_params (client_id, agente, parametro, valor, descripcion, sync_version)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (client_id, parametro) DO UPDATE SET
         agente = EXCLUDED.agente, valor = EXCLUDED.valor,
         descripcion = EXCLUDED.descripcion, sync_version = EXCLUDED.sync_version`,
      [CLIENT_ID, o.agente || null, key, o.valor || '', o.descripcion || null, syncVersion]
    );
    count++;
  }
  return count;
}

// ─── Chunking + Embeddings ─────────────────────────────────────────────────
async function generateChunksAndEmbeddings(pool, parsedData, syncVersion) {
  const chunks = [];

  // ADN + Estilo: 1 chunk concat
  const adnRows = rowsToObjects(parsedData['2-ADN_MARCA'] || []);
  const adnText = adnRows
    .filter((o) => ['propuesta_valor', 'valores_marca', 'tagline', 'descripcion_breve', 'tono_comunicacion'].includes(o.elemento))
    .map((o) => `${o.elemento}: ${o.valor}`).join('\n');
  if (adnText) {
    chunks.push(...chunkRows({
      clientId: CLIENT_ID, syncVersion,
      sourceTable: 'client_branding', sourceExternalId: 'BRANDING',
      fields: { adn_marca: adnText },
    }));
  }

  // DESCRIPCIONES: cada campo largo es un chunk
  for (const o of rowsToObjects(parsedData['5-DESCRIPCIONES'] || [])) {
    if (!o.service_id) continue;
    chunks.push(...chunkRows({
      clientId: CLIENT_ID, syncVersion,
      sourceTable: 'service_descriptions',
      sourceExternalId: o.service_id,
      fields: {
        que_es: o.que_es, para_quien: o.para_quien, protocolo: o.que_incluye_protocolo,
        indicaciones_previas: o.indicaciones_previas, cuidados_posteriores: o.cuidados_posteriores,
        contraindicaciones: o.contraindicaciones, resultados: o.resultados_esperados,
        faq: o.preguntas_frecuentes,
      },
      extraMetadata: { nombre_servicio: o.nombre_servicio },
    }));
  }

  // FAQ: cada fila es un chunk (variante de pregunta + respuesta)
  for (const o of rowsToObjects(parsedData['9-FAQ'] || [])) {
    if (!o.faq_id || !o.respuesta_completa) continue;
    const fullText = `${o.pregunta_variante}\n\n${o.respuesta_completa}`;
    chunks.push(...chunkRows({
      clientId: CLIENT_ID, syncVersion,
      sourceTable: 'faqs', sourceExternalId: o.faq_id,
      fields: { pregunta_respuesta: fullText },
      extraMetadata: { intent_tag: o.intent_tag, pregunta: o.pregunta_variante },
    }));
  }

  // OBJECIONES: trigger + respuestas
  for (const o of rowsToObjects(parsedData['10-OBJECIONES'] || [])) {
    if (!o.obj_id) continue;
    const fullText = [o.frase_trigger, o.respuesta_principal, o.respuesta_seguimiento, o.cierre_sugerido]
      .filter(Boolean).join('\n\n');
    chunks.push(...chunkRows({
      clientId: CLIENT_ID, syncVersion,
      sourceTable: 'objections', sourceExternalId: o.obj_id,
      fields: { objection_full: fullText },
      extraMetadata: { categoria: o.categoria, frase_trigger: o.frase_trigger },
    }));
  }

  // RESTRICCIONES
  for (const o of rowsToObjects(parsedData['13-RESTRICCIONES'] || [])) {
    if (!o.restriccion_id) continue;
    const fullText = `${o.tipo}: ${o.descripcion}${o.razon ? `\nRazón: ${o.razon}` : ''}`;
    chunks.push(...chunkRows({
      clientId: CLIENT_ID, syncVersion,
      sourceTable: 'restrictions', sourceExternalId: o.restriccion_id,
      fields: { restriction_full: fullText },
      extraMetadata: { tipo: o.tipo },
    }));
  }

  if (!chunks.length) {
    warn('No hay chunks para generar.');
    return { chunks: 0, embeddings: 0 };
  }

  log(`Generando embeddings para ${chunks.length} chunks (modelo ${EMBED_MODEL})...`);
  const openai = new OpenAI();

  // Batch en grupos de BATCH_EMBED_SIZE
  let total = 0;
  for (let i = 0; i < chunks.length; i += BATCH_EMBED_SIZE) {
    const batch = chunks.slice(i, i + BATCH_EMBED_SIZE);
    const r = await openai.embeddings.create({
      model: EMBED_MODEL,
      input: batch.map((c) => c.content_text),
    });
    if (r.data.length !== batch.length) {
      throw new Error(`OpenAI devolvió ${r.data.length} embeddings, esperaba ${batch.length}`);
    }
    for (let j = 0; j < batch.length; j++) {
      const c = batch[j];
      const emb = r.data[j].embedding;
      if (emb.length !== EMBED_DIM) {
        throw new Error(`Embedding tiene ${emb.length} dims, esperaba ${EMBED_DIM}`);
      }
      await pool.query(
        `INSERT INTO kb_chunks (
           client_id, source_table, source_external_id, source_field,
           chunk_index, content_text, tokens_estimated, embedding,
           metadata, sync_version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          c.client_id, c.source_table, c.source_external_id, c.source_field,
          c.chunk_index, c.content_text, c.tokens_estimated,
          `[${emb.join(',')}]`,
          JSON.stringify(c.metadata),
          c.sync_version,
        ]
      );
      total++;
    }
    ok(`embeddings ${total}/${chunks.length}`);
  }

  return { chunks: chunks.length, embeddings: total };
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  log(`First Activation · cliente ${CLIENT_ID} · sheet ${SHEET_ID}`);

  const auth = getGoogleAuth();
  const sheetsApi = google.sheets({ version: 'v4', auth });

  const pool = new Pool({
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    max: 5,
  });

  let runId, syncVersion;
  const rowsByTable = {};
  const errors = [];

  try {
    syncVersion = await nextSyncVersion(pool);
    log(`Sync version asignada: ${syncVersion}`);
    runId = await startSyncRun(pool, syncVersion);

    // Cleanup de filas append-only (kb_chunks + schedule_exceptions).
    // Las otras tablas usan ON CONFLICT (idempotente por external_id).
    const delChunks = await pool.query('DELETE FROM kb_chunks WHERE client_id = $1', [CLIENT_ID]);
    const delExcep = await pool.query('DELETE FROM schedule_exceptions WHERE client_id = $1', [CLIENT_ID]);
    log(`Cleanup previo: ${delChunks.rowCount} chunks + ${delExcep.rowCount} schedule_exceptions borrados`);

    log('Leyendo Sheet (16 pestañas)...');
    const tabs = await readAllTabs(sheetsApi);
    ok(`Sheet leído: ${Object.values(tabs).reduce((s, r) => s + r.length, 0)} filas totales`);

    log('Sincronizando 14 pestañas editables a Postgres...');
    rowsByTable.kb_config = await syncKbConfig(pool, tabs['1-KB_CONFIG'] || []);
    rowsByTable.client_branding = await syncAdnAndEstilo(
      pool, tabs['2-ADN_MARCA'] || [], tabs['3-ESTILO_RESPUESTA'] || [], syncVersion
    );
    rowsByTable.services = await syncServices(pool, tabs['4-SERVICIOS'] || [], syncVersion);
    rowsByTable.service_descriptions = await syncDescriptions(pool, tabs['5-DESCRIPCIONES'] || [], syncVersion);
    rowsByTable.promotions = await syncPromotions(pool, tabs['6-PROMOCIONES'] || [], syncVersion);
    const horarios = await syncHorarios(pool, tabs['7-HORARIOS'] || [], syncVersion);
    rowsByTable.schedules = horarios.schedules;
    rowsByTable.schedule_exceptions = horarios.schedule_exceptions;
    rowsByTable.locations = await syncLocations(pool, tabs['8-SEDES'] || [], syncVersion);
    rowsByTable.faqs = await syncFaqs(pool, tabs['9-FAQ'] || [], syncVersion);
    rowsByTable.objections = await syncObjections(pool, tabs['10-OBJECIONES'] || [], syncVersion);
    rowsByTable.team_contacts = await syncTeamContacts(pool, tabs['11-EQUIPO_Y_CONTACTOS'] || [], syncVersion);
    rowsByTable.escalations = await syncEscalations(pool, tabs['12-ESCALAMIENTO'] || [], syncVersion);
    rowsByTable.restrictions = await syncRestrictions(pool, tabs['13-RESTRICCIONES'] || [], syncVersion);
    rowsByTable.reengagement_sequences = await syncReengagement(pool, tabs['14-REENGANCHE'] || [], syncVersion);
    rowsByTable.agent_params = await syncAgentParams(pool, tabs['15-PARAMETROS_AGENTES'] || [], syncVersion);

    for (const [table, count] of Object.entries(rowsByTable)) {
      ok(`${table}: ${count} filas`);
    }

    log('Generando chunks + embeddings...');
    const { chunks, embeddings } = await generateChunksAndEmbeddings(pool, tabs, syncVersion);

    await finishSyncRun(pool, runId, 'ok', {
      rows_upserted: rowsByTable,
      chunks_generated: chunks,
      embeddings_generated: embeddings,
      errors,
    });
    await bumpClientSyncVersion(pool, syncVersion);

    log('================================================================');
    log(`✓ First Activation OK · sync_version=${syncVersion}`);
    log(`  chunks=${chunks} · embeddings=${embeddings}`);
    log('================================================================');
  } catch (e) {
    console.error('FAIL:', e);
    errors.push({ message: e.message, stack: e.stack });
    if (runId) {
      await finishSyncRun(pool, runId, 'failed', { rows_upserted: rowsByTable, errors });
    }
    await pool.query(`UPDATE clients SET last_sync_status = 'failed' WHERE id = $1`, [CLIENT_ID]);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
