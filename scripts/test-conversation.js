// =============================================================================
// test-conversation.js — REPL interactivo para charlar con el agente.
// =============================================================================
// Mantiene una conversación persistente por sesión (con un contactId fijo
// que se guarda en .test-conversation-state). Cada mensaje queda en
// Postgres (conversations + messages) — el agente lo recuerda en el próximo turno.
//
// Uso:
//   node scripts/test-conversation.js              # nueva conversación
//   node scripts/test-conversation.js --resume     # continúa la última
//   node scripts/test-conversation.js --reset      # nueva, descarta state
//
// Comandos dentro del REPL:
//   /exit           — salir
//   /reset          — empezar conversación nueva (cambia contactId)
//   /history        — imprimir historial completo de la conversación actual
//   /meta           — toggle de metadata visible después de cada respuesta
//   /clear          — limpiar pantalla
// =============================================================================

import 'dotenv/config';
import readline from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleMessage } from './agent-message.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_FILE = path.join(__dirname, '..', '.test-conversation-state');

const argv = process.argv.slice(2);
const wantsReset = argv.includes('--reset');
const wantsResume = argv.includes('--resume');

const CLIENT_ID = process.env.PILOT_CLIENT_ID;
if (!CLIENT_ID) {
  console.error('Falta PILOT_CLIENT_ID en .env');
  process.exit(1);
}

function randomContactId() {
  return 'TEST-' + Math.random().toString(36).slice(2, 10).toUpperCase();
}

async function loadState() {
  if (wantsReset) return null;
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveState(state) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

const COLOR = {
  reset: '\x1b[0m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m',
  yellow: '\x1b[33m', magenta: '\x1b[35m', gray: '\x1b[90m',
};

let showMeta = false;
const prior = await loadState();
let contactId = wantsResume && prior?.contactId ? prior.contactId : randomContactId();
let contactName = prior?.contactName || 'Lead Prueba';

console.log(`\n${COLOR.cyan}╔══════════════════════════════════════════════════════════════╗${COLOR.reset}`);
console.log(`${COLOR.cyan}║         Agente IDEA IA · Test conversation REPL              ║${COLOR.reset}`);
console.log(`${COLOR.cyan}╚══════════════════════════════════════════════════════════════╝${COLOR.reset}`);
console.log(`${COLOR.dim}  Cliente:      ${CLIENT_ID.slice(0, 8)}... (Dr. Petro)${COLOR.reset}`);
console.log(`${COLOR.dim}  Contact:      ${contactId}  ${wantsResume && prior ? '(reanudando)' : '(nuevo)'}${COLOR.reset}`);
console.log(`${COLOR.dim}  Comandos:     /exit · /reset · /history · /meta · /clear${COLOR.reset}\n`);

await saveState({ contactId, contactName });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

function prompt() {
  rl.question(`${COLOR.green}lead> ${COLOR.reset}`, async (line) => {
    const msg = line.trim();
    if (!msg) return prompt();

    if (msg === '/exit') { rl.close(); return; }
    if (msg === '/clear') { console.clear(); return prompt(); }
    if (msg === '/meta') { showMeta = !showMeta; console.log(`${COLOR.gray}meta: ${showMeta ? 'ON' : 'OFF'}${COLOR.reset}`); return prompt(); }
    if (msg === '/reset') {
      contactId = randomContactId();
      await saveState({ contactId, contactName });
      console.log(`${COLOR.yellow}— conversación nueva (contact ${contactId}) —${COLOR.reset}\n`);
      return prompt();
    }
    if (msg === '/history') {
      // Lazy import para no abrir pg al inicio si solo se quiere /history
      const { default: pg } = await import('pg');
      const pool = new pg.Pool({
        host: process.env.PG_HOST || 'localhost',
        port: parseInt(process.env.PG_PORT || '5432', 10),
        user: process.env.PG_USER, password: process.env.PG_PASSWORD, database: process.env.PG_DATABASE,
      });
      const r = await pool.query(
        `SELECT m.role, m.content, m.created_at
           FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE c.client_id = $1 AND c.ghl_contact_id = $2
          ORDER BY m.created_at ASC`,
        [CLIENT_ID, contactId]
      );
      await pool.end();
      console.log(`${COLOR.gray}── historial (${r.rowCount} mensajes) ──${COLOR.reset}`);
      r.rows.forEach((row) => {
        const tag = row.role === 'user' ? `${COLOR.green}lead${COLOR.reset}` : `${COLOR.magenta}bot${COLOR.reset} `;
        console.log(`  ${tag}: ${row.content}`);
      });
      console.log('');
      return prompt();
    }

    try {
      const r = await handleMessage({
        clientId: CLIENT_ID,
        contactId,
        contactName,
        channel: 'cli-test',
        body: msg,
      });
      console.log(`${COLOR.magenta}bot${COLOR.reset} : ${r.reply}\n`);
      if (showMeta) {
        console.log(`${COLOR.gray}  meta: ${r.metadata.latencyMs}ms · ${r.metadata.tokensIn}→${r.metadata.tokensOut} tokens${COLOR.reset}`);
        r.metadata.chunksRetrieved.forEach((c, i) =>
          console.log(`${COLOR.gray}    ${i + 1}. ${c.ref} (sim ${c.sim.toFixed(3)})${COLOR.reset}`)
        );
        console.log('');
      }
    } catch (e) {
      console.error(`${COLOR.yellow}error: ${e.message}${COLOR.reset}\n`);
    }
    prompt();
  });
}

rl.on('close', () => {
  console.log(`\n${COLOR.dim}— fin de la sesión. State guardado en .test-conversation-state${COLOR.reset}`);
  process.exit(0);
});

prompt();
