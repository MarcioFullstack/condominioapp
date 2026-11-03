import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import jwt from '@fastify/jwt';
import { config } from '../config.js';
import { q } from '../db.js';

export interface Sessao {
  sub: string;
  cid: string;
  papel: string;
  perms: string[];
  nome: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: Sessao;
    user: Sessao;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    auth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    exige: (...perms: string[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function setupAuth(app: FastifyInstance) {
  await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: '12h' } });

  app.decorate('auth', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ erro: 'Não autenticado' });
    }
    // Revalida no banco: usuário desativado ou permissão revogada vale na hora.
    const [u] = await q('SELECT ativo, papel, permissoes_extra FROM usuario WHERE id = $1', [req.user.sub]);
    if (!u || !u.ativo) return reply.code(401).send({ erro: 'Usuário inativo' });
    const { permissoesDe } = await import('../lib/permissions.js');
    req.user.perms = permissoesDe(u.papel, u.permissoes_extra);
    req.user.papel = u.papel;
  });

  app.decorate('exige', (...perms: string[]) => async (req: FastifyRequest, reply: FastifyReply) => {
    await app.auth(req, reply);
    if (reply.sent) return;
    if (!perms.some((p) => req.user.perms.includes(p))) {
      return reply.code(403).send({ erro: 'Sem permissão' });
    }
  });
}
