#!/usr/bin/env node
// =============================================================================
// Test de retrieval semántico contra el KB de un cliente.
// Genera embedding del query → similarity search en kb_chunks → imprime top-K.
// =============================================================================
// Uso:
//   node scripts/test-retrieval.js "¿cuánto cuesta el botox?"
//   node scripts/test-retrieval.js "tengo miedo del dolor" 5
// =============================================================================

import 'dotenv/config';
import pg from 'pg';
import OpenAI from 'openai';

const { Pool } = pg;
const CLIENT_ID = process.env.PILOT_CLIENT_ID;
const EMBED_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

const query = process.argv[2] || '¿cuánto cuesta el botox?';
const topK = parseInt(process.argv[3] || '5', 10);

if (!CLIENT_ID) {
  console.error('FAIL: PILOT_CLIENT_ID requerido en .env');
  process.exit(1);
}

const openai = new OpenAI();
const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

try {
  console.log(`Query: "${query}"`);
  console.log(`Top-${topK} chunks del cliente ${CLIENT_ID.slice(0, 8)}...\n`);

  const t0 = Date.now();
  const emb = await openai.embeddings.create({ model: EMBED_MODEL, input: query });
  const vec = emb.data[0].embedding;
  const tEmbed = Date.now() - t0;

  const t1 = Date.now();
  const r = await pool.query(
    `SELECT source_table, source_external_id, source_field, chunk_index, content_text,
            tokens_estimated, metadata,
            1 - (embedding <=> $1::vector) AS similarity
     FROM kb_chunks
     WHERE client_id = $2
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [`[${vec.join(',')}]`, CLIENT_ID, topK]
  );
  const tQuery = Date.now() - t1;

  console.log(`Embedding: ${tEmbed}ms · Query: ${tQuery}ms · Total: ${tEmbed + tQuery}ms\n`);
  console.log('─'.repeat(80));

  r.rows.forEach((row, i) => {
    const meta = row.metadata && Object.keys(row.metadata).length
      ? ' · ' + Object.entries(row.metadata).map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 30) : v}`).join(', ')
      : '';
    console.log(`#${i + 1}  sim=${row.similarity.toFixed(3)}  [${row.source_table}/${row.source_external_id}/${row.source_field}]${meta}`);
    const preview = String(row.content_text).replace(/\s+/g, ' ').slice(0, 300);
    console.log(`     ${preview}${preview.length === 300 ? '...' : ''}`);
    console.log('─'.repeat(80));
  });
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
