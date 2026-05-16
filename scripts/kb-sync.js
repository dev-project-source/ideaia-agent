// =============================================================================
// kb-sync.js — Sincroniza el Sheet del cliente con Postgres si cambió.
// =============================================================================
// Diseñado para correr cada 15 min via cron n8n (workflow 04-kb-sync-cron).
// Pasos:
//   1. Lee el cliente de Postgres (sheet_id + last_sheet_modified_at)
//   2. Llama Drive API para obtener modifiedTime actual del Sheet
//   3. Si modifiedTime > last_sheet_modified_at → llama runActivation()
//   4. Actualiza last_sheet_modified_at en clients
//   5. Si no cambió, devuelve { ok: true, skipped: true }
//
// Uso CLI:
//   node scripts/kb-sync.js                    # cliente default (PILOT_CLIENT_ID)
//   node scripts/kb-sync.js <clientId>         # cliente específico
//   node scripts/kb-sync.js --force            # forzar sync aunque no haya cambiado
// =============================================================================

import 'dotenv/config';
import { google } from 'googleapis';
import pg from 'pg';
import { runActivation } from './first-activation.js';

const { Pool } = pg;

function getGoogleAuth() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!b64) throw new Error('Falta GOOGLE_SERVICE_ACCOUNT_KEY en .env');
  const credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  });
}

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

/**
 * Lee el modifiedTime del Sheet via Drive API.
 * Returns ISO string o null si no se puede.
 */
async function getSheetModifiedTime(sheetId, auth) {
  const drive = google.drive({ version: 'v3', auth });
  const r = await drive.files.get({
    fileId: sheetId,
    fields: 'modifiedTime',
    supportsAllDrives: true,
  });
  return r.data.modifiedTime;
}

/**
 * Función exportable (usada por agent-server endpoint y por CLI).
 */
export async function runKbSync({ clientId, pool, force = false } = {}) {
  const ownsPool = !pool;
  pool = pool || new Pool({
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    max: 5,
  });

  clientId = clientId || process.env.PILOT_CLIENT_ID;
  if (!clientId) {
    if (ownsPool) await pool.end();
    return { ok: false, error: 'clientId requerido' };
  }

  try {
    // 1. Buscar el cliente
    const { rows } = await pool.query(
      'SELECT id, business_name, sheet_id, last_sheet_modified_at FROM clients WHERE id = $1',
      [clientId]
    );
    if (!rows.length) {
      return { ok: false, error: `Cliente ${clientId} no existe` };
    }
    const client = rows[0];
    if (!client.sheet_id) {
      return { ok: false, error: `Cliente ${client.business_name} no tiene sheet_id` };
    }

    log(`KB Sync · cliente ${client.business_name} (${clientId.slice(0, 8)}...)`);
    log(`Sheet ID: ${client.sheet_id}`);

    // 2. Drive API → modifiedTime
    const auth = getGoogleAuth();
    const modifiedTime = await getSheetModifiedTime(client.sheet_id, auth);
    log(`Sheet modificado:    ${modifiedTime}`);
    log(`Última sync local:   ${client.last_sheet_modified_at || '(nunca)'}`);

    // 3. ¿Necesita sync?
    const sheetChanged =
      !client.last_sheet_modified_at ||
      new Date(modifiedTime) > new Date(client.last_sheet_modified_at);

    if (!sheetChanged && !force) {
      log('✓ Sin cambios, sync omitido.');
      return {
        ok: true,
        skipped: true,
        clientId,
        sheetId: client.sheet_id,
        modifiedTime,
      };
    }

    if (force) log('⚡ Force=true, ejecutando sync aunque no haya cambios.');
    else log('⚡ Sheet cambió, ejecutando sync...');

    // 4. Ejecutar first-activation completo (idempotente)
    const result = await runActivation({
      clientId,
      sheetId: client.sheet_id,
      pool,
    });

    if (!result.ok) {
      return { ok: false, error: result.error || 'runActivation falló', result };
    }

    // 5. Actualizar last_sheet_modified_at
    await pool.query(
      `UPDATE clients SET last_sheet_modified_at = $2 WHERE id = $1`,
      [clientId, modifiedTime]
    );

    log(`✓ Sync OK · sync_version=${result.syncVersion} · chunks=${result.chunks}`);
    return {
      ok: true,
      synced: true,
      clientId,
      sheetId: client.sheet_id,
      modifiedTime,
      ...result,
    };
  } catch (e) {
    console.error('FAIL kb-sync:', e);
    return { ok: false, error: e.message };
  } finally {
    if (ownsPool) await pool.end();
  }
}

// CLI
import { fileURLToPath } from 'node:url';
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const clientId = args.find((a) => !a.startsWith('-'));

  runKbSync({ clientId, force }).then((r) => {
    console.log('\nResultado:', JSON.stringify(r, null, 2));
    if (!r.ok) process.exit(1);
  });
}
