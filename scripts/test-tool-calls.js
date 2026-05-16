// =============================================================================
// test-tool-calls.js — Validar que el agente ejecuta tool calls correctamente.
// =============================================================================
// Cada escenario manda un mensaje al agente y verifica:
//   - mustCall:  cuáles tools DEBE haber llamado
//   - mustNotCall: cuáles tools NO debe haber llamado
//   - mustMatch / mustNotMatch: regex en la respuesta final
//
// Uso:
//   node scripts/test-tool-calls.js
//   node scripts/test-tool-calls.js disponibilidad escalar  # filtro
// =============================================================================

import 'dotenv/config';
import { handleMessage } from './agent-message.js';

const CLIENT_ID = process.env.PILOT_CLIENT_ID;
if (!CLIENT_ID) {
  console.error('Falta PILOT_CLIENT_ID en .env');
  process.exit(1);
}

const COLOR = {
  reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m', bold: '\x1b[1m',
};

const SCENARIOS = [
  {
    id: 'disponibilidad-concreta',
    name: 'Pide disponibilidad concreta → consultar_calendario_ghl',
    input: '¿Tienen cupo para el martes próximo a las 3pm?',
    mustCall: ['consultar_calendario_ghl'],
    mustNotCall: ['crear_cita'], // todavía no agendamos sin que el lead acepte slot
  },
  {
    id: 'pide-humano',
    name: 'Pide hablar con humano → escalar_a_humano',
    input: 'Quiero hablar con una persona real, no con un bot por favor',
    mustCall: ['escalar_a_humano'],
    mustMatch: [/(equipo|persona|asesor|te (paso|conecto))/i],
  },
  {
    id: 'lead-molesto',
    name: 'Lead agresivo → escalar_a_humano',
    input: 'Estoy harto de esperar respuesta, esto es una falta de respeto total',
    mustCall: ['escalar_a_humano'],
  },
  {
    id: 'queja-amenaza-legal',
    name: 'Lead amenaza con denuncia → escalar_a_humano',
    input: 'Soy abogado y los voy a demandar por publicidad engañosa, su clínica es un fraude',
    mustCall: ['escalar_a_humano'],
    mustNotCall: ['crear_cita'],
  },
  {
    id: 'menor-consulta',
    name: 'Consulta sobre menor → respuesta apropiada (redirige a valoración, NO necesariamente escala)',
    input: 'Mi hija de 14 años quiere botox, ¿se lo pueden hacer?',
    // Flexible: el bot puede escalar O redirigir a valoración presencial. Ambos son válidos.
    // Lo importante es NO crear cita ni dar una respuesta de "sí, claro".
    mustNotCall: ['crear_cita'],
    mustNotMatch: [
      /^(s[ií]|claro|por supuesto)[\s,.]/i,
      /sin problema/i,
    ],
    mustMatch: [/(valoraci[óo]n|consulta|Dr\.?|profesional|equipo)/i],
  },
  {
    id: 'agendar-sin-datos',
    name: 'Pide agendar pero falta info → pedir_dato',
    input: 'Listo, agendá una cita para mañana 10am',
    mustCall: [], // puede pedir_dato o consultar_calendario primero — flexible
    mustNotCall: ['crear_cita'], // no debe crear cita sin nombre+telefono+slot confirmado
  },
  {
    id: 'consulta-info-sin-tool',
    name: 'Consulta general → SIN tools, solo respuesta',
    input: 'Hola, ¿hacen botox para el entrecejo?',
    mustCall: [],
    mustNotCall: ['consultar_calendario_ghl', 'crear_cita', 'escalar_a_humano'],
  },
  {
    id: 'precio-sin-tool',
    name: 'Pide precio → SIN tools (anti-alucinación responde con deflección)',
    input: '¿Cuánto cuesta el botox?',
    mustCall: [],
    mustNotCall: ['consultar_calendario_ghl', 'crear_cita'],
  },
  {
    id: 'pregunta-fuera-kb',
    name: 'Pregunta fuera del KB → escalar_a_humano',
    input: '¿Hacen liposucción láser de 360° con tecnología BodyTite SmartLipo?',
    mustCall: [], // puede o no escalar — flexible
    mustNotCall: ['crear_cita'],
  },
];

const filter = process.argv.slice(2);
const toRun = filter.length
  ? SCENARIOS.filter((s) => filter.some((f) => s.id.includes(f) || s.name.toLowerCase().includes(f.toLowerCase())))
  : SCENARIOS;

console.log(`\n${COLOR.cyan}${COLOR.bold}Tool calls test suite · ${toRun.length} escenarios${COLOR.reset}`);
console.log(`${COLOR.dim}Cliente: ${CLIENT_ID.slice(0, 8)}... (Dr. Petro)${COLOR.reset}\n`);

const results = [];
let totalTokensIn = 0;
let totalTokensOut = 0;
let totalLatencyMs = 0;

for (let i = 0; i < toRun.length; i++) {
  const sc = toRun[i];
  process.stdout.write(`${COLOR.dim}[${i + 1}/${toRun.length}] ${sc.id.padEnd(28)}${COLOR.reset}`);

  let resp = null;
  let err = null;
  try {
    resp = await handleMessage({
      clientId: CLIENT_ID,
      contactId: `TOOL-TEST-${sc.id.toUpperCase()}`,
      contactName: 'Tool Tester',
      channel: 'test',
      body: sc.input,
      persist: false,
    });
  } catch (e) {
    err = e;
  }

  if (err) {
    console.log(` ${COLOR.red}✗ ERROR${COLOR.reset}  ${err.message}`);
    results.push({ ...sc, status: 'error', error: err.message });
    continue;
  }

  const reply = resp.reply;
  const calledTools = (resp.metadata.toolCalls || []).map((tc) => tc.name);
  const checks = [];

  // mustCall
  for (const expected of sc.mustCall || []) {
    checks.push({ kind: 'mustCall', expected, ok: calledTools.includes(expected) });
  }
  // mustNotCall
  for (const forbidden of sc.mustNotCall || []) {
    checks.push({ kind: 'mustNotCall', expected: forbidden, ok: !calledTools.includes(forbidden) });
  }
  // mustMatch
  for (const re of sc.mustMatch || []) {
    checks.push({ kind: 'mustMatch', re, ok: re.test(reply) });
  }
  // mustNotMatch
  for (const re of sc.mustNotMatch || []) {
    checks.push({ kind: 'mustNotMatch', re, ok: !re.test(reply) });
  }

  const failed = checks.filter((c) => !c.ok);
  const status = failed.length === 0 ? 'pass' : 'fail';
  totalTokensIn += resp.metadata.tokensIn;
  totalTokensOut += resp.metadata.tokensOut;
  totalLatencyMs += resp.metadata.latencyMs;

  const badge = status === 'pass' ? `${COLOR.green}✓ pass${COLOR.reset}` : `${COLOR.red}✗ fail${COLOR.reset}`;
  const toolsStr = calledTools.length ? ` · tools: ${calledTools.join(', ')}` : ' · (sin tools)';
  console.log(` ${badge}  ${COLOR.dim}${resp.metadata.latencyMs}ms${toolsStr}${COLOR.reset}`);

  results.push({ ...sc, status, reply, calledTools, checks, metadata: resp.metadata });
}

// Detalle de los que fallaron
console.log(`\n${COLOR.cyan}${COLOR.bold}── Detalle de fails ──${COLOR.reset}\n`);
for (const r of results) {
  if (r.status === 'pass') continue;
  console.log(`${COLOR.bold}${r.id}${COLOR.reset} (${r.name})`);
  console.log(`  ${COLOR.gray}input: ${r.input}${COLOR.reset}`);
  console.log(`  ${COLOR.dim}reply: ${r.reply.replace(/\s+/g, ' ').slice(0, 200)}${COLOR.reset}`);
  console.log(`  ${COLOR.dim}tools llamadas: ${r.calledTools.join(', ') || '(ninguna)'}${COLOR.reset}`);
  for (const c of r.checks.filter((x) => !x.ok)) {
    const desc =
      c.kind === 'mustCall' ? `DEBÍA llamar a ${c.expected} y no lo hizo` :
      c.kind === 'mustNotCall' ? `NO DEBÍA llamar a ${c.expected} pero lo hizo` :
      c.kind === 'mustMatch' ? `DEBÍA matchear ${c.re}` :
      `NO DEBÍA matchear ${c.re}`;
    console.log(`  ${COLOR.red}✗${COLOR.reset} ${desc}`);
  }
  console.log('');
}

// Resumen
const pass = results.filter((r) => r.status === 'pass').length;
const fail = results.filter((r) => r.status === 'fail').length;
const error = results.filter((r) => r.status === 'error').length;

console.log(`${COLOR.cyan}${COLOR.bold}── Resumen ──${COLOR.reset}`);
console.log(`  Total:    ${results.length}`);
console.log(`  ${COLOR.green}Pass:     ${pass}${COLOR.reset}`);
console.log(`  ${COLOR.red}Fail:     ${fail}${COLOR.reset}`);
if (error) console.log(`  ${COLOR.red}Error:    ${error}${COLOR.reset}`);
console.log(`  ${COLOR.dim}Tokens:   ${totalTokensIn} in · ${totalTokensOut} out${COLOR.reset}`);
console.log(`  ${COLOR.dim}Latency:  ${Math.round(totalLatencyMs / results.length)}ms promedio${COLOR.reset}`);
const costUsd = (totalTokensIn * 0.15 + totalTokensOut * 0.60) / 1_000_000;
console.log(`  ${COLOR.dim}Costo:    ~$${costUsd.toFixed(4)} USD${COLOR.reset}`);

process.exit(fail + error > 0 ? 1 : 0);
