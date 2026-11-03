import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { q, q1, tx } from '../db.js';
import { audita } from '../lib/audit.js';
import { encargos, hojeISO } from '../lib/money.js';
import { criarCobrancaPSP, pspAtivo } from '../lib/psp.js';
import { atualizarPainel, publicar } from '../lib/realtime.js';

const competenciaSchema = z.string().regex(/^\d{4}-\d{2}$/);

/**
 * Baixa idempotente: marca a cobrança como paga e lança no livro-caixa
 * (principal em "Taxa Condominio"; excedente em "Multas/ Juros por Atraso").
 */
export async function baixarCobranca(cobrancaId: string, valorPagoCentavos: number, dataPagamento: string, criadoPor: string | null) {
  return tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM cobranca WHERE id = $1 FOR UPDATE', [cobrancaId]);
    const cb = rows[0];
    if (!cb || cb.status === 'paga') return null;
    const cat = async (nome: string) =>
      (await c.query("SELECT id FROM categoria WHERE condominio_id = $1 AND nome = $2 AND tipo = 'receita'", [cb.condominio_id, nome])).rows[0]?.id;
    const catTaxa = await cat('Taxa Condominio');
    const catMulta = await cat('Multas/ Juros por Atraso');
    const conta = (await c.query("SELECT id FROM conta WHERE condominio_id = $1 AND tipo = 'caixa'", [cb.condominio_id])).rows[0];
    const un = (await c.query('SELECT identificador FROM unidade WHERE id = $1', [cb.unidade_id])).rows[0];
    const principal = Math.min(valorPagoCentavos, Number(cb.valor_centavos));
    const extra = valorPagoCentavos - principal;
    const ins = (categoria: string, valor: number, desc: string) =>
      c.query(
        `INSERT INTO lancamento (condominio_id, tipo, categoria_id, conta_id, unidade_id, cobranca_id, competencia, data_pagamento,
                                 valor_centavos, descricao, favorecido, criado_por)
         VALUES ($1,'entrada',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [cb.condominio_id, categoria, conta.id, cb.unidade_id, cb.id, cb.competencia, dataPagamento, valor, desc, un.identificador, criadoPor],
      );
    const l = await ins(catTaxa, principal, `Taxa de condomínio ${String(cb.competencia).slice(0, 7)} - ${un.identificador}`);
    if (extra > 0) await ins(catMulta, extra, `Multa/juros ${String(cb.competencia).slice(0, 7)} - ${un.identificador}`);
    await c.query(
      "UPDATE cobranca SET status = 'paga', pago_em = $2, valor_pago_centavos = $3 WHERE id = $1",
      [cb.id, dataPagamento, valorPagoCentavos],
    );
    return { cobranca: cb, lancamentoId: l.rows[0].id, extra };
  });
}

async function notificarBaixa(cobrancaId: string, cid: string, unidadeId: string) {
  const moradores = await q('SELECT usuario_id FROM vinculo WHERE unidade_id = $1', [unidadeId]);
  publicar(cid, 'cobranca.paga', { id: cobrancaId }, { usuarios: moradores.map((m) => m.usuario_id) });
  publicar(cid, 'cobranca.paga', { id: cobrancaId }, { perm: 'inadimplencia:ver' });
  atualizarPainel(cid);
}

export async function cobrancasRoutes(app: FastifyInstance) {
  // Gera a taxa do mês para todas as unidades com taxa > 0 (idempotente por unidade/competência).
  app.post('/cobrancas/gerar', { preHandler: app.exige('cobranca:gerar') }, async (req) => {
    const { competencia } = z.object({ competencia: competenciaSchema }).parse(req.body);
    const cond = await q1('SELECT dia_vencimento FROM condominio WHERE id = $1', [req.user.cid]);
    const inicio = `${competencia}-01`;
    const vencimento = `${competencia}-${String(cond.dia_vencimento).padStart(2, '0')}`;
    const unidades = await q(
      `SELECT * FROM unidade WHERE condominio_id = $1 AND taxa_centavos > 0
         AND NOT EXISTS (SELECT 1 FROM cobranca c WHERE c.unidade_id = unidade.id AND c.competencia = $2::date)`,
      [req.user.cid, inicio],
    );
    let criadas = 0;
    const falhasPsp: string[] = [];
    for (const u of unidades) {
      const cb = await q1(
        `INSERT INTO cobranca (condominio_id, unidade_id, competencia, vencimento, valor_centavos)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.user.cid, u.id, inicio, vencimento, u.taxa_centavos],
      );
      criadas++;
      if (pspAtivo() && u.responsavel_cpf_cnpj) {
        try {
          const p = await criarCobrancaPSP({
            pagador: { nome: u.responsavel_nome ?? u.identificador, cpfCnpj: u.responsavel_cpf_cnpj, customerId: u.psp_customer_id },
            valorCentavos: cb.valor_centavos,
            vencimento,
            descricao: `Taxa de condomínio ${competencia} - ${u.identificador}`,
            referencia: cb.id,
          });
          await q('UPDATE cobranca SET psp_id = $1, psp_link = $2 WHERE id = $3', [p.id, p.link, cb.id]);
          await q('UPDATE unidade SET psp_customer_id = $1 WHERE id = $2', [p.customerId, u.id]);
        } catch (e) {
          falhasPsp.push(`${u.identificador}: ${(e as Error).message}`);
        }
      }
      const moradores = await q('SELECT usuario_id FROM vinculo WHERE unidade_id = $1', [u.id]);
      publicar(req.user.cid, 'cobranca.nova', { id: cb.id, competencia }, { usuarios: moradores.map((m) => m.usuario_id) });
    }
    await audita(req, 'cobrancas.geradas', 'cobranca', undefined, { competencia, criadas });
    atualizarPainel(req.user.cid);
    return { criadas, ignoradas: 0, falhasPsp, modoPsp: pspAtivo() ? 'asaas' : 'manual' };
  });

  // Visão da administração
  app.get('/cobrancas', { preHandler: app.exige('inadimplencia:ver', 'financeiro:ver') }, async (req) => {
    const f = z.object({ competencia: competenciaSchema.optional(), status: z.enum(['aberta', 'paga', 'cancelada']).optional() }).parse(req.query);
    return q(
      `SELECT c.id, c.competencia, c.vencimento, c.valor_centavos, c.status, c.pago_em, c.valor_pago_centavos, c.psp_link, un.identificador AS unidade
       FROM cobranca c JOIN unidade un ON un.id = c.unidade_id
       WHERE c.condominio_id = $1 AND ($2::text IS NULL OR to_char(c.competencia,'YYYY-MM') = $2) AND ($3::text IS NULL OR c.status = $3)
       ORDER BY c.competencia DESC, un.identificador`,
      [req.user.cid, f.competencia ?? null, f.status ?? null],
    );
  });

  // Visão do morador: só as cobranças das próprias unidades, com multa/juros calculados hoje.
  app.get('/minhas-cobrancas', { preHandler: app.auth }, async (req) => {
    const cond = await q1('SELECT multa_bps, juros_mensal_bps FROM condominio WHERE id = $1', [req.user.cid]);
    const rows = await q(
      `SELECT c.id, c.competencia, c.vencimento, c.valor_centavos, c.status, c.pago_em, c.valor_pago_centavos, c.psp_link, un.identificador AS unidade
       FROM cobranca c JOIN unidade un ON un.id = c.unidade_id
       JOIN vinculo v ON v.unidade_id = c.unidade_id AND v.usuario_id = $1
       WHERE c.status <> 'cancelada' ORDER BY c.competencia DESC`,
      [req.user.sub],
    );
    const hoje = hojeISO();
    return rows.map((r) => ({
      ...r,
      ...(r.status === 'aberta' ? encargos(r.valor_centavos, r.vencimento, hoje, cond.multa_bps, cond.juros_mensal_bps) : {}),
    }));
  });

  // Painel de inadimplentes: só síndico/tesoureiro/conselho (nunca moradores).
  app.get('/inadimplencia', { preHandler: app.exige('inadimplencia:ver') }, async (req) => {
    const cond = await q1('SELECT multa_bps, juros_mensal_bps FROM condominio WHERE id = $1', [req.user.cid]);
    const hoje = hojeISO();
    const abertas = await q(
      `SELECT c.id, c.competencia, c.vencimento, c.valor_centavos, c.psp_link, c.unidade_id, un.identificador AS unidade
       FROM cobranca c JOIN unidade un ON un.id = c.unidade_id
       WHERE c.condominio_id = $1 AND c.status = 'aberta' AND c.vencimento < $2::date ORDER BY c.vencimento`,
      [req.user.cid, hoje],
    );
    const porUnidade = new Map<string, any>();
    for (const c of abertas) {
      const e = encargos(c.valor_centavos, c.vencimento, hoje, cond.multa_bps, cond.juros_mensal_bps);
      const u = porUnidade.get(c.unidade_id) ?? { unidade_id: c.unidade_id, unidade: c.unidade, cobrancas: [], original_centavos: 0, total_centavos: 0, max_dias: 0 };
      u.cobrancas.push({ ...c, ...e });
      u.original_centavos += c.valor_centavos;
      u.total_centavos += e.total;
      u.max_dias = Math.max(u.max_dias, e.dias);
      porUnidade.set(c.unidade_id, u);
    }
    const lista = [...porUnidade.values()].sort((a, b) => b.total_centavos - a.total_centavos);
    const [{ n }] = await q("SELECT count(*)::int AS n FROM unidade WHERE condominio_id = $1 AND taxa_centavos > 0", [req.user.cid]);
    return {
      unidades_inadimplentes: lista.length,
      percentual: n ? Math.round((lista.length / n) * 1000) / 10 : 0,
      total_em_aberto_centavos: lista.reduce((s, u) => s + u.total_centavos, 0),
      unidades: lista,
    };
  });

  // Baixa manual (modo sem PSP, ou pagamento em dinheiro/transferência)
  app.post('/cobrancas/:id/baixa-manual', { preHandler: app.exige('financeiro:lancar') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ valor_pago_centavos: z.number().int().positive(), data_pagamento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => hojeISO()) }).parse(req.body);
    const cb = await q1('SELECT unidade_id FROM cobranca WHERE id = $1 AND condominio_id = $2', [id, req.user.cid]);
    if (!cb) return reply.code(404).send({ erro: 'Cobrança não encontrada' });
    const r = await baixarCobranca(id, b.valor_pago_centavos, b.data_pagamento, req.user.sub);
    if (!r) return reply.code(409).send({ erro: 'Cobrança já paga' });
    await audita(req, 'cobranca.baixa_manual', 'cobranca', id, b);
    await notificarBaixa(id, req.user.cid, cb.unidade_id);
    return { ok: true };
  });

  // Webhook do PSP (Asaas). Autenticado por token compartilhado no header.
  app.post('/webhooks/psp', async (req, reply) => {
    if (!config.PSP_WEBHOOK_TOKEN || req.headers['asaas-access-token'] !== config.PSP_WEBHOOK_TOKEN) {
      return reply.code(401).send({ erro: 'Token inválido' });
    }
    const body = z
      .object({
        event: z.string(),
        payment: z.object({ id: z.string(), value: z.number(), paymentDate: z.string().nullish(), confirmedDate: z.string().nullish() }).optional(),
      })
      .parse(req.body);
    if (!['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(body.event) || !body.payment) return { ok: true, ignorado: true };
    const cb = await q1('SELECT id, condominio_id, unidade_id FROM cobranca WHERE psp_id = $1', [body.payment.id]);
    if (!cb) return { ok: true, ignorado: true };
    const dataPg = body.payment.paymentDate ?? body.payment.confirmedDate ?? hojeISO();
    const r = await baixarCobranca(cb.id, Math.round(body.payment.value * 100), dataPg, null);
    if (r) await notificarBaixa(cb.id, cb.condominio_id, cb.unidade_id);
    return { ok: true };
  });
}
