import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { q, q1, tx } from '../db.js';
import { audita } from '../lib/audit.js';
import { competenciaDe, hojeISO } from '../lib/money.js';
import { atualizarPainel, publicar } from '../lib/realtime.js';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const lancSchema = z.object({
  tipo: z.enum(['entrada', 'saida']),
  categoria_id: z.string().uuid(),
  conta: z.enum(['caixa', 'fundo_reserva']).default('caixa'),
  unidade_id: z.string().uuid().optional(),
  competencia: data.optional(),
  data_pagamento: data.default(() => hojeISO()),
  valor_centavos: z.number().int().positive(),
  descricao: z.string().min(2),
  favorecido: z.string().optional(),
});

const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export async function financeiroRoutes(app: FastifyInstance) {
  app.get('/categorias', { preHandler: app.auth }, async (req) =>
    q('SELECT id, nome, tipo FROM categoria WHERE condominio_id = $1 AND ativo ORDER BY tipo, nome', [req.user.cid]),
  );

  app.post('/categorias', { preHandler: app.exige('financeiro:lancar') }, async (req) => {
    const b = z.object({ nome: z.string().min(2), tipo: z.enum(['receita', 'despesa']) }).parse(req.body);
    const c = await q1(
      'INSERT INTO categoria (condominio_id, nome, tipo) VALUES ($1,$2,$3) ON CONFLICT (condominio_id, nome, tipo) DO UPDATE SET ativo = true RETURNING *',
      [req.user.cid, b.nome, b.tipo],
    );
    await audita(req, 'categoria.criada', 'categoria', c.id, b);
    return c;
  });

  app.get('/contas/saldos', { preHandler: app.exige('financeiro:ver') }, async (req) =>
    q(
      `SELECT c.id, c.nome, c.tipo,
              COALESCE(SUM(CASE WHEN l.tipo = 'entrada' THEN l.valor_centavos ELSE -l.valor_centavos END), 0) AS saldo_centavos
       FROM conta c LEFT JOIN lancamento l ON l.conta_id = c.id
       WHERE c.condominio_id = $1 GROUP BY c.id ORDER BY c.tipo`,
      [req.user.cid],
    ),
  );

  app.get('/lancamentos', { preHandler: app.exige('financeiro:ver') }, async (req) => {
    const f = z
      .object({
        competencia: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        tipo: z.enum(['entrada', 'saida']).optional(),
        categoria_id: z.string().uuid().optional(),
        conta: z.enum(['caixa', 'fundo_reserva']).optional(),
        limite: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(req.query);
    return q(
      `SELECT l.id, l.seq, l.tipo, l.valor_centavos, l.descricao, l.favorecido, l.competencia, l.data_pagamento,
              l.estorno_de, l.created_at, cat.nome AS categoria, cat.tipo AS categoria_tipo, co.tipo AS conta,
              un.identificador AS unidade, u.nome AS criado_por,
              EXISTS (SELECT 1 FROM lancamento e WHERE e.estorno_de = l.id) AS estornado,
              COALESCE((SELECT json_agg(json_build_object('id', cp.id, 'nome', cp.nome_original, 'mime', cp.mime))
                        FROM comprovante cp WHERE cp.lancamento_id = l.id), '[]') AS comprovantes
       FROM lancamento l
       JOIN categoria cat ON cat.id = l.categoria_id
       JOIN conta co ON co.id = l.conta_id
       LEFT JOIN unidade un ON un.id = l.unidade_id
       LEFT JOIN usuario u ON u.id = l.criado_por
       WHERE l.condominio_id = $1
         AND ($2::text IS NULL OR to_char(l.competencia, 'YYYY-MM') = $2)
         AND ($3::text IS NULL OR l.tipo = $3)
         AND ($4::uuid IS NULL OR l.categoria_id = $4)
         AND ($5::text IS NULL OR co.tipo = $5)
       ORDER BY l.data_pagamento DESC, l.seq DESC LIMIT $6`,
      [req.user.cid, f.competencia ?? null, f.tipo ?? null, f.categoria_id ?? null, f.conta ?? null, f.limite],
    );
  });

  app.post('/lancamentos', { preHandler: app.exige('financeiro:lancar') }, async (req, reply) => {
    const b = lancSchema.parse(req.body);
    const cat = await q1('SELECT tipo FROM categoria WHERE id = $1 AND condominio_id = $2', [b.categoria_id, req.user.cid]);
    if (!cat) return reply.code(400).send({ erro: 'Categoria inválida' });
    if ((b.tipo === 'entrada') !== (cat.tipo === 'receita')) {
      return reply.code(400).send({ erro: `Categoria de ${cat.tipo} não combina com ${b.tipo}` });
    }
    const conta = await q1('SELECT id FROM conta WHERE condominio_id = $1 AND tipo = $2', [req.user.cid, b.conta]);
    const l = await q1(
      `INSERT INTO lancamento (condominio_id, tipo, categoria_id, conta_id, unidade_id, competencia, data_pagamento,
                               valor_centavos, descricao, favorecido, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        req.user.cid, b.tipo, b.categoria_id, conta.id, b.unidade_id ?? null,
        b.competencia ?? competenciaDe(b.data_pagamento), b.data_pagamento, b.valor_centavos,
        b.descricao, b.favorecido ?? null, req.user.sub,
      ],
    );
    await audita(req, 'lancamento.criado', 'lancamento', l.id, { tipo: b.tipo, valor_centavos: b.valor_centavos });
    publicar(req.user.cid, 'lancamento.criado', { id: l.id, tipo: l.tipo, valor_centavos: l.valor_centavos, descricao: l.descricao }, { perm: 'financeiro:ver' });
    atualizarPainel(req.user.cid);
    return l;
  });

  // Correção = estorno (lançamento oposto, vinculado ao original). Nada é editado nem apagado.
  app.post('/lancamentos/:id/estorno', { preHandler: app.exige('financeiro:lancar') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { motivo } = z.object({ motivo: z.string().min(3) }).parse(req.body);
    const o = await q1('SELECT * FROM lancamento WHERE id = $1 AND condominio_id = $2', [id, req.user.cid]);
    if (!o) return reply.code(404).send({ erro: 'Lançamento não encontrado' });
    if (o.estorno_de) return reply.code(400).send({ erro: 'Um estorno não pode ser estornado' });
    if (await q1('SELECT 1 FROM lancamento WHERE estorno_de = $1', [id])) {
      return reply.code(409).send({ erro: 'Lançamento já estornado' });
    }
    const e = await q1(
      `INSERT INTO lancamento (condominio_id, tipo, categoria_id, conta_id, unidade_id, cobranca_id, competencia, data_pagamento,
                               valor_centavos, descricao, favorecido, estorno_de, criado_por)
       VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        req.user.cid, o.tipo === 'entrada' ? 'saida' : 'entrada', o.categoria_id, o.conta_id, o.unidade_id,
        o.competencia, hojeISO(), o.valor_centavos, `ESTORNO: ${motivo} (ref. ${o.descricao})`, o.favorecido, o.id, req.user.sub,
      ],
    );
    await audita(req, 'lancamento.estornado', 'lancamento', id, { motivo, estorno: e.id });
    atualizarPainel(req.user.cid);
    return e;
  });

  // ---------- Comprovantes ----------
  app.post('/lancamentos/:id/comprovante', { preHandler: app.exige('financeiro:lancar') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await q1('SELECT 1 FROM lancamento WHERE id = $1 AND condominio_id = $2', [id, req.user.cid]))) {
      return reply.code(404).send({ erro: 'Lançamento não encontrado' });
    }
    const file = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ erro: 'Envie um arquivo' });
    if (!MIMES.has(file.mimetype)) return reply.code(400).send({ erro: 'Use JPG, PNG, WEBP ou PDF' });
    const buf = await file.toBuffer();
    if (file.file.truncated) return reply.code(413).send({ erro: 'Arquivo acima de 10 MB' });
    const rel = join(req.user.cid, `${randomUUID()}${extname(file.filename).toLowerCase().slice(0, 6)}`);
    const abs = resolve(config.UPLOAD_DIR, rel);
    await mkdir(resolve(config.UPLOAD_DIR, req.user.cid), { recursive: true });
    await writeFile(abs, buf);
    const c = await q1(
      'INSERT INTO comprovante (lancamento_id, arquivo, nome_original, mime) VALUES ($1,$2,$3,$4) RETURNING id, nome_original, mime',
      [id, rel, file.filename, file.mimetype],
    );
    await audita(req, 'comprovante.anexado', 'lancamento', id, { comprovante: c.id });
    return c;
  });

  // Download autenticado (o arquivo nunca é servido como estático público).
  app.get('/comprovantes/:id', { preHandler: app.exige('financeiro:ver') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await q1(
      `SELECT cp.* FROM comprovante cp JOIN lancamento l ON l.id = cp.lancamento_id
       WHERE cp.id = $1 AND l.condominio_id = $2`,
      [id, req.user.cid],
    );
    if (!c) return reply.code(404).send({ erro: 'Comprovante não encontrado' });
    const abs = resolve(config.UPLOAD_DIR, c.arquivo);
    if (!abs.startsWith(resolve(config.UPLOAD_DIR)) || !existsSync(abs)) return reply.code(404).send({ erro: 'Arquivo ausente' });
    return reply.type(c.mime).send(createReadStream(abs));
  });

  // ---------- Relatório mensal (base da prestação de contas) ----------
  app.get('/relatorios/mensal', { preHandler: app.exige('financeiro:ver') }, async (req) => {
    const { competencia } = z.object({ competencia: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query);
    const inicio = `${competencia}-01`;
    const porCategoria = await q(
      `SELECT cat.nome AS categoria, cat.tipo,
              SUM(CASE WHEN (cat.tipo = 'receita') = (l.tipo = 'entrada') THEN l.valor_centavos ELSE -l.valor_centavos END) AS total_centavos
       FROM lancamento l JOIN categoria cat ON cat.id = l.categoria_id
       WHERE l.condominio_id = $1 AND l.data_pagamento >= $2::date AND l.data_pagamento < ($2::date + interval '1 month')
       GROUP BY cat.id ORDER BY cat.tipo, total_centavos DESC`,
      [req.user.cid, inicio],
    );
    const [anterior] = await q(
      `SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN valor_centavos ELSE -valor_centavos END), 0) AS saldo
       FROM lancamento WHERE condominio_id = $1 AND data_pagamento < $2::date`,
      [req.user.cid, inicio],
    );
    const receitas = porCategoria.filter((r) => r.tipo === 'receita').reduce((s, r) => s + r.total_centavos, 0);
    const despesas = porCategoria.filter((r) => r.tipo === 'despesa').reduce((s, r) => s + r.total_centavos, 0);
    return {
      competencia,
      saldo_anterior_centavos: anterior.saldo,
      receitas_centavos: receitas,
      despesas_centavos: despesas,
      resultado_centavos: receitas - despesas,
      saldo_final_centavos: anterior.saldo + receitas - despesas,
      por_categoria: porCategoria,
    };
  });
}
