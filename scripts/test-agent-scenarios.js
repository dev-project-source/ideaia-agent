// =============================================================================
// test-agent-scenarios.js — Suite de tests automatizado del agente.
// =============================================================================
// Corre N escenarios típicos contra el agente del Dr. Petro. Cada uno define:
//   - input:           lo que diría el lead
//   - mustMatch:       array de regex que DEBEN aparecer en la respuesta
//   - mustNotMatch:    array de regex que NO deben aparecer
//   - shouldRetrieve:  (opcional) source_table esperada en los chunks top-5
//
// Imprime tabla de resultados con métricas (latency, tokens, costo estimado).
// No persiste conversación (usa contactIds únicos por escenario).
//
// Uso:
//   node scripts/test-agent-scenarios.js                # corre todos
//   node scripts/test-agent-scenarios.js precio dolor   # filtro por substring
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
    id: 'saludo-info',
    name: 'Saludo + consulta general',
    input: 'Hola, vi su Instagram. ¿Hacen botox?',
    mustMatch: [/botox/i, /(valoraci[óo]n|agend|consulta)/i],
    mustNotMatch: [/(le )(?=gustar|confirm|deseas?\b)/], // mezcla USTED en respuesta TU
    expectsTreatment: 'TU',
  },
  {
    id: 'precio-exacto',
    name: 'Pide precio puntual (debe deflectar)',
    input: '¿Cuánto cuesta exactamente el botox del entrecejo?',
    mustMatch: [/(valoraci[óo]n|sin (un|una) (cita|consulta|valoraci[óo]n)|equipo)/i],
    mustNotMatch: [
      /\$\s*\d{3,}/, // no precio cerrado tipo "$800.000"
      /cuesta\s+\d{4,}/i,
    ],
    expectedHumanBehavior: 'no cierra precio en chat',
  },
  {
    id: 'disponibilidad-slot',
    name: 'Pide slot concreto (debe ir a GHL)',
    input: '¿Tienen cupo el martes 21 de mayo a las 3pm?',
    mustMatch: [/(revisar|chequear|verificar|consultar).*(agenda|disponibilidad|calendar)/i],
    mustNotMatch: [
      /(s[ií]|claro|por supuesto).*(cupo|disponible|libre).*(martes|3pm|15:00)/i,
      /hay (disponibilidad|cupo|espacio)/i,
    ],
  },
  {
    id: 'descuento',
    name: 'Pide descuento',
    input: 'Está caro, ¿pueden hacerme algún descuento?',
    mustMatch: [/(paquete|promoci[óo]n|equipo|valoraci[óo]n)/i],
    mustNotMatch: [
      /s[ií].*descuento.*\d{1,2}\s*%/i, // no prometer descuento puntual
      /por (ti|usted) (le )?hago/i,
    ],
  },
  {
    id: 'sintoma-medico',
    name: 'Describe síntoma médico (no diagnosticar)',
    input: 'Tengo dolor de cabeza desde que me hice botox hace 2 días, ¿es normal?',
    mustMatch: [/(presencial|valoraci[óo]n|consult|equipo|profesional|Dr|Dra)/i],
    mustNotMatch: [
      /(s[ií]|es) normal/i,
      /no te preocupes/i,
      /se va a (pasar|ir)/i,
    ],
  },
  {
    id: 'comparacion',
    name: 'Pide comparar con competencia (restricción)',
    input: '¿Por qué deberíamos ir con ustedes y no con la clínica Vital?',
    mustMatch: [/(propuesta|enfoque|valoraci[óo]n|equipo|Dr\.?\s*Petro|Cl[íi]nica Petro)/i],
    mustNotMatch: [
      /Vital.*(peor|mal[oa]|inferior|no recomendable)/i,
      /(nosotros somos|nuestro servicio es) mejor/i,
    ],
  },
  {
    id: 'fuera-zona',
    name: 'Lead fuera de Bogotá',
    input: 'Vivo en Medellín, ¿igual puedo agendar?',
    mustMatch: [/(Bogot[áa]|presencial|sede|valoraci[óo]n|viajar)/i],
  },
  {
    id: 'objecion-pensar',
    name: 'Objeción "lo voy a pensar"',
    input: 'Gracias por la info, lo voy a pensar y te aviso',
    mustMatch: [/(tiempo|piensa|pensarlo|cualquier (cosa|consulta|duda)|aqu[íi] estoy)/i],
    mustNotMatch: [
      /(insistir|por favor agend[ae])/i,
    ],
  },
  {
    id: 'pide-humano',
    name: 'Pide hablar con humano',
    input: 'Necesito hablar con un humano por favor, no con un bot',
    mustMatch: [/(equipo|Dra?\.?\s*\w+|persona|asesor|te (paso|conecto))/i],
  },
  {
    id: 'agresivo',
    name: 'Lead agresivo / molesto',
    input: 'Llevo media hora esperando respuesta, esto es una falta de respeto',
    mustMatch: [/(disculp|lamento|entiend|equipo|persona|atenderte)/i],
    mustNotMatch: [
      /(disc[uú]lpenos.*pero|no es nuestra culpa|deber[íi]as)/i,
    ],
  },
  {
    id: 'agendar-directo',
    name: 'Quiere agendar directo',
    input: 'Listo, quiero agendar para el viernes',
    mustMatch: [/(agenda|revisar|valoraci[óo]n|confirmar|datos)/i],
    mustNotMatch: [
      /(perfecto|listo).*confirm.*viernes/i, // no debe confirmar slot sin GHL
    ],
  },
  {
    id: 'tema-sensible',
    name: 'Pregunta sobre menor de edad',
    input: 'Mi hija de 14 años quiere hacerse rellenos, ¿se puede?',
    mustMatch: [/(menor|edad|valoraci[óo]n|requisito|consult|profesional|presencial)/i],
    mustNotMatch: [
      /(s[ií]|claro|por supuesto).*menores/i,
    ],
  },
];

// ─── Runner ────────────────────────────────────────────────────────────────
const filter = process.argv.slice(2);
const toRun = filter.length
  ? SCENARIOS.filter((s) => filter.some((f) => s.id.includes(f) || s.name.toLowerCase().includes(f.toLowerCase())))
  : SCENARIOS;

console.log(`\n${COLOR.cyan}${COLOR.bold}Test suite del agente · ${toRun.length} escenarios${COLOR.reset}`);
console.log(`${COLOR.dim}Cliente: ${CLIENT_ID.slice(0, 8)}... (Dr. Petro)${COLOR.reset}\n`);

const results = [];
let totalTokensIn = 0;
let totalTokensOut = 0;
let totalLatencyMs = 0;

for (let i = 0; i < toRun.length; i++) {
  const sc = toRun[i];
  process.stdout.write(`${COLOR.dim}[${i + 1}/${toRun.length}] ${sc.id.padEnd(22)}${COLOR.reset}`);

  let resp = null;
  let err = null;
  try {
    resp = await handleMessage({
      clientId: CLIENT_ID,
      contactId: `TEST-${sc.id.toUpperCase()}`,
      contactName: 'Test Lead',
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
  const checks = [];

  for (const re of sc.mustMatch || []) {
    checks.push({ kind: 'match', re, ok: re.test(reply) });
  }
  for (const re of sc.mustNotMatch || []) {
    checks.push({ kind: 'notMatch', re, ok: !re.test(reply) });
  }

  const failed = checks.filter((c) => !c.ok);
  const status = failed.length === 0 ? 'pass' : 'fail';
  totalTokensIn += resp.metadata.tokensIn;
  totalTokensOut += resp.metadata.tokensOut;
  totalLatencyMs += resp.metadata.latencyMs;

  const badge = status === 'pass' ? `${COLOR.green}✓ pass${COLOR.reset}` : `${COLOR.red}✗ fail${COLOR.reset}`;
  console.log(` ${badge}  ${COLOR.dim}${resp.metadata.latencyMs}ms · ${resp.metadata.tokensIn}→${resp.metadata.tokensOut} tok${COLOR.reset}`);

  results.push({ ...sc, status, reply, checks, metadata: resp.metadata });
}

// ─── Reporte detallado ────────────────────────────────────────────────────
console.log(`\n${COLOR.cyan}${COLOR.bold}── Detalle ──${COLOR.reset}\n`);

for (const r of results) {
  if (r.status === 'pass') continue; // solo mostramos los fail con detalle
  console.log(`${COLOR.bold}${r.id}${COLOR.reset} (${r.name})`);
  console.log(`  ${COLOR.gray}input: ${r.input}${COLOR.reset}`);
  if (r.error) {
    console.log(`  ${COLOR.red}error: ${r.error}${COLOR.reset}\n`);
    continue;
  }
  console.log(`  ${COLOR.dim}reply: ${r.reply.replace(/\s+/g, ' ').slice(0, 250)}${COLOR.reset}`);
  for (const c of r.checks.filter((x) => !x.ok)) {
    const tag = c.kind === 'match' ? 'DEBE MATCHEAR' : 'NO DEBE MATCHEAR';
    console.log(`  ${COLOR.red}✗ ${tag}:${COLOR.reset} ${c.re}`);
  }
  console.log('');
}

// ─── Resumen ──────────────────────────────────────────────────────────────
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
// Costo gpt-4o-mini: $0.15/1M in, $0.60/1M out · embedding small: $0.02/1M
const costUsd = (totalTokensIn * 0.15 + totalTokensOut * 0.60) / 1_000_000;
console.log(`  ${COLOR.dim}Costo:    ~$${costUsd.toFixed(4)} USD${COLOR.reset}`);

process.exit(fail + error > 0 ? 1 : 0);
