import type { FastifyInstance } from 'fastify';
import { q, q1 } from '../db.js';
import { encargos, hojeISO } from '../lib/money.js';

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard', { preHandler: app.exige('dashboard:ver') }, async (req) => {
    const cid = req.user.cid;
    const mes = `${hojeISO().slice(0, 7)}-01`;
    const podeFinanceiro = req.user.perms.includes('financeiro:ver');
    const podeInad = req.user.perms.includes('inadimplencia:ver');

    const saldos = podeFinanceiro
      ? await q(
          `SELECT c.tipo, c.nome, COALESCE(SUM(CASE WHEN l.tipo = 'entrada' THEN l.valor_centavos ELSE -l.valor_centavos END), 0) AS saldo_centavos
           FROM conta c LEFT JOIN lancamento l ON l.conta_id = c.id WHERE c.condominio_id = $1 GROUP BY c.id ORDER BY c.tipo`,
          [cid],
        )
      : [];

    const porCategoria = podeFinanceiro
      ? await q(
          `SELECT cat.nome AS categoria, cat.tipo,
                  SUM(CASE WHEN (cat.tipo = 'receita') = (l.tipo = 'entrada') THEN l.valor_centavos ELSE -l.valor_centavos END) AS total_centavos
           FROM lancamento l JOIN categoria cat ON cat.id = l.categoria_id
           WHERE l.condominio_id = $1 AND l.data_pagamento >= $2::date AND l.data_pagamento < ($2::date + interval '1 month')
           GROUP BY cat.id ORDER BY total_centavos DESC`,
          [cid, mes],
        )
      : [];
    const receitas = porCategoria.filter((c) => c.tipo === 'receita').reduce((s, c) => s + c.total_centavos, 0);
    const despesas = porCategoria.filter((c) => c.tipo === 'despesa').reduce((s, c) => s + c.total_centavos, 0);

    const ultimas = podeFinanceiro
      ? await q(
          `SELECT l.id, l.tipo, l.valor_centavos, l.descricao, l.data_pagamento, cat.nome AS categoria, un.identificador AS unidade,
                  EXISTS (SELECT 1 FROM comprovante cp WHERE cp.lancamento_id = l.id) AS tem_comprovante
           FROM lancamento l JOIN categoria cat ON cat.id = l.categoria_id LEFT JOIN unidade un ON un.id = l.unidade_id
           WHERE l.condominio_id = $1 ORDER BY l.created_at DESC LIMIT 10`,
          [cid],
        )
      : [];

    let inadimplencia = null;
    if (podeInad) {
      const cond = await q1('SELECT multa_bps, juros_mensal_bps FROM condominio WHERE id = $1', [cid]);
      const hoje = hojeISO();
      const abertas = await q(
        "SELECT unidade_id, valor_centavos, vencimento FROM cobranca WHERE condominio_id = $1 AND status = 'aberta' AND vencimento < $2::date",
        [cid, hoje],
      );
      const unidades = new Set(abertas.map((a) => a.unidade_id));
      const total = abertas.reduce((s, a) => s + encargos(a.valor_centavos, a.vencimento, hoje, cond.multa_bps, cond.juros_mensal_bps).total, 0);
      const [{ n }] = await q('SELECT count(*)::int AS n FROM unidade WHERE condominio_id = $1 AND taxa_centavos > 0', [cid]);
      inadimplencia = {
        unidades: unidades.size,
        percentual: n ? Math.round((unidades.size / n) * 1000) / 10 : 0,
        total_centavos: total,
      };
    }

    const [sol] = await q(
      "SELECT count(*) FILTER (WHERE status IN ('aberta','em_analise'))::int AS aguardando, count(*) FILTER (WHERE status = 'em_execucao')::int AS em_execucao FROM solicitacao WHERE condominio_id = $1",
      [cid],
    );

    const cameras = req.user.perms.includes('cameras:ver')
      ? (await q("SELECT count(*) FILTER (WHERE online)::int AS online, count(*) FILTER (WHERE NOT online)::int AS offline FROM camera WHERE condominio_id = $1 AND ativo", [cid]))[0]
      : null;

    return {
      competencia: mes.slice(0, 7),
      saldos,
      mes: { receitas_centavos: receitas, despesas_centavos: despesas, resultado_centavos: receitas - despesas, por_categoria: porCategoria },
      ultimas,
      inadimplencia,
      solicitacoes: sol,
      cameras,
    };
  });
}
