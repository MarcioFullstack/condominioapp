import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

await pool.query(`CREATE TABLE IF NOT EXISTS _migrations (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())`);
const feitas = new Set((await pool.query('SELECT nome FROM _migrations')).rows.map((r) => r.nome));

for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  if (feitas.has(f)) continue;
  console.log('aplicando', f);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(readFileSync(join(dir, f), 'utf8'));
    await c.query('INSERT INTO _migrations(nome) VALUES ($1)', [f]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
console.log('migrações em dia');
await pool.end();
