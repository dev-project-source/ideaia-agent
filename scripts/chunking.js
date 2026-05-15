// =====================================================================
// chunking.js — partición de textos largos en chunks para embeddings.
// ---------------------------------------------------------------------
// Uso esperado dentro del workflow "First Activation":
//
//   const { chunkText, chunkRows } = require('./chunking');
//   const chunks = chunkText(faq.respuesta, { maxTokens: 500 });
//   //  → [{ text, tokensEstimated, chunkIndex, totalChunks }, ...]
//
// Diseño:
//   - Heurística simple de tokenización: ~4 chars/token para español.
//     No usamos tiktoken para mantenerlo zero-deps. La estimación es
//     conservadora (sobrestima un 5-10% — está OK).
//   - Split por párrafos primero (preserva semántica). Si un párrafo
//     supera maxTokens lo partimos por oraciones. Si una oración sigue
//     siendo larga, hard-split por chars.
//   - Overlap opcional entre chunks (default 50 tokens) — útil para
//     no perder contexto en los bordes durante retrieval semántico.
// =====================================================================

const CHARS_PER_TOKEN_ES = 4; // español ≈ 4 chars/token (heurística)

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN_ES);
}

function splitIntoParagraphs(text) {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function splitIntoSentences(text) {
  // Split por punto/exclamación/interrogación seguidos de espacio + mayúscula.
  // Conserva el delimitador en la oración.
  const parts = text.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

function hardSplit(text, maxChars) {
  const out = [];
  for (let i = 0; i < text.length; i += maxChars) {
    out.push(text.slice(i, i + maxChars));
  }
  return out;
}

/**
 * Parte un texto en chunks de ~maxTokens cada uno.
 * @param {string} text - texto a chunkear
 * @param {object} opts
 * @param {number} [opts.maxTokens=500]
 * @param {number} [opts.overlapTokens=50]
 * @returns {Array<{text:string, tokensEstimated:number, chunkIndex:number, totalChunks:number}>}
 */
function chunkText(text, opts = {}) {
  const { maxTokens = 500, overlapTokens = 50 } = opts;

  if (!text || !text.trim()) return [];

  const total = estimateTokens(text);
  if (total <= maxTokens) {
    return [
      {
        text: text.trim(),
        tokensEstimated: total,
        chunkIndex: 0,
        totalChunks: 1,
      },
    ];
  }

  const maxChars = maxTokens * CHARS_PER_TOKEN_ES;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN_ES;

  // 1. Primero intentamos por párrafos
  const paragraphs = splitIntoParagraphs(text);

  // 2. Si algún párrafo es muy largo, lo partimos por oraciones
  const units = [];
  for (const p of paragraphs) {
    if (estimateTokens(p) <= maxTokens) {
      units.push(p);
    } else {
      const sentences = splitIntoSentences(p);
      for (const s of sentences) {
        if (estimateTokens(s) <= maxTokens) {
          units.push(s);
        } else {
          // 3. Si una oración sigue siendo larga (texto sin puntuación), hard-split
          units.push(...hardSplit(s, maxChars));
        }
      }
    }
  }

  // 4. Agrupamos units en chunks con overlap
  const chunks = [];
  let current = '';
  for (const u of units) {
    const candidate = current ? `${current}\n\n${u}` : u;
    if (estimateTokens(candidate) <= maxTokens) {
      current = candidate;
    } else {
      if (current) {
        chunks.push(current);
        // overlap: arrastrar el último tail al próximo chunk
        const tail = current.slice(-overlapChars).trim();
        current = tail && tail !== current ? `${tail}\n\n${u}` : u;
      } else {
        // u por sí solo es más grande que maxTokens (no debería pasar tras hard-split)
        chunks.push(u);
        current = '';
      }
    }
  }
  if (current) chunks.push(current);

  return chunks.map((chunkContent, i) => ({
    text: chunkContent.trim(),
    tokensEstimated: estimateTokens(chunkContent),
    chunkIndex: i,
    totalChunks: chunks.length,
  }));
}

/**
 * Convierte una fila del KB en N filas de `kb_chunks` listas para INSERT.
 * Acepta una "definición de fuente" + la fila + un sync_version.
 *
 * @example
 *   chunkRows({
 *     sourceTable: 'faqs',
 *     sourceExternalId: row.external_id,
 *     fields: { respuesta: row.respuesta },
 *     clientId, syncVersion,
 *   })
 *   → [{ client_id, source_table, source_external_id, source_field,
 *        chunk_index, content_text, tokens_estimated, metadata }, ...]
 */
function chunkRows({
  clientId,
  syncVersion,
  sourceTable,
  sourceExternalId,
  fields, // objeto { fieldName: text }
  extraMetadata = {},
  chunkOpts = {},
}) {
  const rows = [];
  for (const [fieldName, fieldText] of Object.entries(fields)) {
    if (!fieldText || !String(fieldText).trim()) continue;
    const pieces = chunkText(String(fieldText), chunkOpts);
    for (const piece of pieces) {
      rows.push({
        client_id: clientId,
        source_table: sourceTable,
        source_external_id: sourceExternalId,
        source_field: fieldName,
        chunk_index: piece.chunkIndex,
        content_text: piece.text,
        tokens_estimated: piece.tokensEstimated,
        metadata: {
          total_chunks: piece.totalChunks,
          ...extraMetadata,
        },
        sync_version: syncVersion,
      });
    }
  }
  return rows;
}

export { estimateTokens, chunkText, chunkRows };

// ---------------------------------------------------------------------
// Self-test cuando se corre directo: node scripts/chunking.js
// ---------------------------------------------------------------------
import { fileURLToPath } from 'node:url';
const isMain = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
               process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const short = 'Esta es una FAQ corta. Cabe en un solo chunk.';
  const long =
    'Primer párrafo de la descripción del tratamiento. '.repeat(20) +
    '\n\nSegundo párrafo más largo todavía, con detalles del protocolo. '.repeat(30) +
    '\n\nTercer párrafo final con contraindicaciones y cuidados. '.repeat(25);

  console.log('--- chunkText("short") ---');
  console.log(chunkText(short));

  console.log('\n--- chunkText("long") ---');
  const out = chunkText(long, { maxTokens: 200, overlapTokens: 30 });
  out.forEach((c) => {
    console.log(
      `  chunk ${c.chunkIndex + 1}/${c.totalChunks} · ${c.tokensEstimated} tokens · ${c.text.slice(0, 80)}...`,
    );
  });

  console.log('\n--- chunkRows() para una fila de service_descriptions ---');
  const rows = chunkRows({
    clientId: '00000000-0000-0000-0000-000000000000',
    syncVersion: 1,
    sourceTable: 'service_descriptions',
    sourceExternalId: 'SRV_001',
    fields: {
      que_es: 'Aplicación de toxina botulínica para suavizar arrugas dinámicas.',
      protocolo:
        'Valoración previa de 30 minutos. Aplicación con aguja muy fina, dura aproximadamente 15 minutos. '.repeat(8),
      cuidados_posteriores: '',
    },
    chunkOpts: { maxTokens: 150 },
  });
  console.log(`  → ${rows.length} chunks generados`);
  rows.forEach((r, i) => {
    console.log(`    [${i}] field=${r.source_field} idx=${r.chunk_index} tokens=${r.tokens_estimated}`);
  });
}
