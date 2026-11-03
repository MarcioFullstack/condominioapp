import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { q, q1, tx } from '../db.js';
import { audita } from '../lib/audit.js';
import { competenciaDe, hojeISO } from '../lib/money.js';
import { atualizarPainel, publicar } from '../lib/realtime.js';
import { salvarUpload } from '../lib/uploads.js';

const tipos = ['manutencao', 'reclamacao', 'sugestao', 'segunda_via_boleto', 'autorizacao_obra', 'reserva_area', 'outros'] as const;
const status = ['aberta', 'em_analise', 'em_execucao', 'concluida', 'recusada'] as const;

const veTodas = (req: FastifyRequest) => req.user.perms.includes('solicitacao:ver_todas');

/** Morador só vê as próprias; síndico, subsíndico e zelador veem todas. */
async function buscar(req: FastifyRequest, id: string) {
  const s = await q1('SELECT * FROM solicitacao WHERE id = $1 AND condominio_id = $2', [id, req.user.cid]);
  if (!s) return null;
  if (!veTodas(req) && s.solicitante_id !== req.user.sub) return null;
  return s;
}

export async function solicitacoesRoutes(app: FastifyInstance) {
  app.get('/solicitacoes', { preHandler: app.auth }, async (req) => {
    const f = z.object({ status: z.enum(status).optional() }).parse(req.query);
    return q(
      `SELECT s.id, s.tipo, s.prioridade, s.titulo, s.status, s.local, s.created_at, s.updated_at,
              u.nome AS solicitante, un.identificador AS unidade,
              (SELECT count(*)::int FROM solicitacao_comentario c WHERE c.solicitacao_id = s.id) AS comentarios
       FROM solicitacao s JOIN usuario u ON u.id = s.solicitante_id LEFT JOIN unidade un ON un.id = s.unidade_id
       WHERE s.condominio_id = $1 AND ($2::boolean OR s.solicitante_id = $3) AND ($4::text IS NULL OR s.status = $4)
       ORDER BY (s.status IN ('concluida','recusada')), s.updated_at DESC`,
      [req.user.cid, veTodas(req), req.user.sub, f.status ?? null],
    );
  });

  app.post('/solicitacoes', { preHandler: app.auth }, async (req) => {
    const b = z
      .object({
        tipo: z.enum(tipos),
        prioridade: z.enum(['baixa', 'media', 'alta']).default('media'),
        titulo: z.string().min(3),
        descricao: z.string().min(3),
        local: z.string().optional(),
        unidade_id: z.string().uuid().optional(),
      })
      .parse(req.body);
    let unidade = b.unidade_id ?? null;
    if (unidade && !veTodas(req)) {
      const v = await q1('SELECT 1 FROM vinculo WHERE usuario_id = $1 AND unidade_id = $2', [req.user.sub, unidade]);
      if (!v) unidade = null;
    }
    const s = await q1(
      `INSERT INTO solicitacao (condominio_id, unidade_id, solicitante_id, tipo, prioridade, titulo, descricao, local)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.cid, unidade, req.user.sub, b.tipo, b.prioridade, b.titulo, b.descricao, b.local ?? null],
    );
    publicar(req.user.cid, 'solicitacao.nova', { id: s.id, titulo: s.titulo }, { perm: 'solicitacao:ver_todas' });
    atualizarPainel(req.user.cid);
    return s;
  });

  app.get('/solicitacoes/:id', { preHandler: app.auth }, async (req, reply) => {
    const s = await buscar(req, (req.params as { id: string }).id);
    if (!s) return reply.code(404).send({ erro: 'Solicitação não encontrada' });
    const comentarios = await q(
      `SELECT c.id, c.texto, c.created_at, u.nome AS autor FROM solicitacao_comentario c JOIN usuario u ON u.id = c.usuario_id
       WHERE c.solicitacao_id = $1 ORDER BY c.created_at`,
      [s.id],
    );
    return { ...s, comentarios };
  });

  app.post('/solicitacoes/:id/comentarios', { preHandler: app.auth }, async (req, reply) => {
    const s = await buscar(req, (req.params as { id: string }).id);
    if (!s) return reply.code(404).send({ erro: 'Solicitação não encontrada' });
    const { texto } = z.object({ texto: z.string().min(1) }).parse(req.body);
    const c = await q1('INSERT INTO solicitacao_comentario (solicitacao_id, usuario_id, texto) VALUES ($1,$2,$3) RETURNING *', [s.id, req.user.sub, texto]);
    await q('UPDATE solicitacao SET updated_at = now() WHERE id = $1', [s.id]);
    publicar(req.user.cid, 'solicitacao.atualizada', { id: s.id }, { usuarios: [s.solicitante_id] });
    publicar(req.user.cid, 'solicitacao.atualizada', { id: s.id }, { perm: 'solicitacao:ver_todas' });
    return c;
  });

  app.patch('/solicitacoes/:id', { preHandler: app.exige('solicitacao:gerir') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ status: z.enum(status), observacao: z.string().optional() }).parse(req.body);
    const s = await q1(
      'UPDATE solicitacao SET status = $1, updated_at = now() WHERE id = $2 AND condominio_id = $3 RETURNING *',
      [b.status, id, req.user.cid],
    );
    if (!s) return reply.code(404).send({ erro: 'Solicitação não encontrada' });
    if (b.observacao) {
      await q('INSERT INTO solicitacao_comentario (solicitacao_id, usuario_id, texto) VALUES ($1,$2,$3)', [id, req.user.sub, b.observacao]);
    }
    await audita(req, 'solicitacao.status', 'solicitacao', id, b);
    // Cada mudança de status avisa o solicitante e a administração em tempo real.
    publicar(req.user.cid, 'solicitacao.atualizada', { id, status: b.status }, { usuarios: [s.solicitante_id] });
    publicar(req.user.cid, 'solicitacao.atualizada', { id, status: b.status }, { perm: 'solicitacao:ver_todas' });
    atualizarPainel(req.user.cid);
    return s;
  });

  app.post('/solicitacoes/:id/anexos', { preHandler: app.auth }, async (req, reply) => {
    const s = await buscar(req, (req.params as { id: string }).id);
    if (!s) return reply.code(404).send({ erro: 'Solicitação não encontrada' });
    const r = await salvarUpload(req, 'solic');
    if ('erro' in r) return reply.code(400).send({ erro: r.erro });
    await q('UPDATE solicitacao SET anexos = array_append(anexos, $1) WHERE id = $2', [r.rel, s.id]);
    return { arquivo: r.rel };
  });

  // Solicitação de manutenção → despesa no caixa, vinculada.
  app.post('/solicitacoes/:id/despesa', { preHandler: app.exige('financeiro:lancar') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await q1('SELECT * FROM solicitacao WHERE id = $1 AND condominio_id = $2', [id, req.user.cid]);
    if (!s) return reply.code(404).send({ erro: 'Solicitação não encontrada' });
    if (s.lancamento_id) return reply.code(409).send({ erro: 'Já vinculada a uma despesa' });
    const b = z
      .object({
        categoria_id: z.string().uuid(),
        valor_centavos: z.number().int().positive(),
        data_pagamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => hojeISO()),
        favorecido: z.string().optional(),
      })
      .parse(req.body);
    const cat = await q1("SELECT 1 FROM categoria WHERE id = $1 AND condominio_id = $2 AND tipo = 'despesa'", [b.categoria_id, req.user.cid]);
    if (!cat) return reply.code(400).send({ erro: 'Use uma categoria de despesa' });
    const l = await tx(async (c) => {
      const conta = (await c.query("SELECT id FROM conta WHERE condominio_id = $1 AND tipo = 'caixa'", [req.user.cid])).rows[0];
      const r = await c.query(
        `INSERT INTO lancamento (condominio_id, tipo, categoria_id, conta_id, competencia, data_pagamento, valor_centavos, descricao, favorecido, criado_por)
         VALUES ($1,'saida',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [req.user.cid, b.categoria_id, conta.id, competenciaDe(b.data_pagamento), b.data_pagamento, b.valor_centavos, `Solicitação: ${s.titulo}`, b.favorecido ?? null, req.user.sub],
      );
      await c.query('UPDATE solicitacao SET lancamento_id = $1, updated_at = now() WHERE id = $2', [r.rows[0].id, id]);
      return r.rows[0];
    });
    await audita(req, 'solicitacao.despesa', 'solicitacao', id, { lancamento: l.id });
    atualizarPainel(req.user.cid);
    return { lancamento_id: l.id };
  });
}
