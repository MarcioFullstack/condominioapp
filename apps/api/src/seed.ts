import bcrypt from 'bcryptjs';
import { pool, q1, tx } from './db.js';

/** Cria um condomínio de exemplo com o plano de contas herdado da planilha original. */
const RECEITAS = ['Taxa Condominio', 'Fundo de reserva', 'Taxa Extra', 'Multas/ Juros por Atraso', 'Outros'];
const DESPESAS = [
  'Energia Elétrica', 'Água e Esgoto', 'Internet Deck', 'Jardinagem / Poda', 'Manutenção de Portões / Cerca',
  'Material de Limpeza', 'Lâmpadas / Material Elétrico', 'Honorários / Administração', 'Tarifa Bancária', 'Outros',
];

if (await q1('SELECT 1 FROM condominio LIMIT 1')) {
  console.log('Já existe condomínio; seed ignorado.');
  await pool.end();
  process.exit(0);
}

const senhaPadrao = process.env.SEED_SENHA ?? 'Trocar@123';
const hash = await bcrypt.hash(senhaPadrao, 10);

await tx(async (c) => {
  const cond = (await c.query("INSERT INTO condominio (nome) VALUES ('Condomínio Exemplo') RETURNING id")).rows[0];
  const cid = cond.id;

  await c.query("INSERT INTO conta (condominio_id, nome, tipo) VALUES ($1,'Caixa','caixa'),($1,'Fundo de reserva','fundo_reserva')", [cid]);
  for (const n of RECEITAS) await c.query("INSERT INTO categoria (condominio_id, nome, tipo) VALUES ($1,$2,'receita')", [cid, n]);
  for (const n of DESPESAS) await c.query("INSERT INTO categoria (condominio_id, nome, tipo) VALUES ($1,$2,'despesa')", [cid, n]);

  const canais: [string, string, string, boolean][] = [
    ['geral', 'Geral', 'geral', false],
    ['avisos', 'Avisos', 'avisos', true],
    ['financeiro', 'Financeiro', 'financeiro', false],
    ['manutencao', 'Manutenção', 'manutencao', false],
  ];
  for (const [slug, nome, tipo, so] of canais) {
    await c.query('INSERT INTO canal (condominio_id, slug, nome, tipo, somente_sindico_escreve) VALUES ($1,$2,$3,$4,$5)', [cid, slug, nome, tipo, so]);
  }

  const unidades: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const u = (await c.query('INSERT INTO unidade (condominio_id, identificador, taxa_centavos) VALUES ($1,$2,$3) RETURNING id', [cid, `Casa ${i}`, 25000])).rows[0];
    unidades.push(u.id);
  }

  const usuarios: [string, string, string, number | null][] = [
    ['Síndico Exemplo', 'sindico@exemplo.com', 'sindico', 0],
    ['Tesoureiro Exemplo', 'tesoureiro@exemplo.com', 'tesoureiro', 1],
    ['Zelador Exemplo', 'zelador@exemplo.com', 'zelador', null],
    ['Morador Exemplo', 'morador@exemplo.com', 'morador', 2],
  ];
  for (const [nome, email, papel, un] of usuarios) {
    const u = (await c.query('INSERT INTO usuario (condominio_id, nome, email, senha_hash, papel) VALUES ($1,$2,$3,$4,$5) RETURNING id', [cid, nome, email, hash, papel])).rows[0];
    if (un !== null) await c.query('INSERT INTO vinculo (usuario_id, unidade_id) VALUES ($1,$2)', [u.id, unidades[un]]);
  }
});

console.log(`Seed concluído. Logins: sindico@exemplo.com | tesoureiro@exemplo.com | zelador@exemplo.com | morador@exemplo.com — senha: ${senhaPadrao}`);
await pool.end();
