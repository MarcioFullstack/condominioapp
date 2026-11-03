import type { FastifyRequest } from 'fastify';
import { q } from '../db.js';

export async function audita(
  req: FastifyRequest,
  acao: string,
  entidade?: string,
  entidadeId?: string,
  dados?: unknown,
) {
  await q(
    `INSERT INTO auditoria (condominio_id, usuario_id, acao, entidade, entidade_id, dados, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [req.user.cid, req.user.sub, acao, entidade ?? null, entidadeId ?? null, dados ? JSON.stringify(dados) : null, req.ip],
  );
}
