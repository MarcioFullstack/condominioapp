import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { z } from 'zod';
import { q, q1 } from '../db.js';
import { permissoesDe } from '../lib/permissions.js';
import { audita } from '../lib/audit.js';

const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
  totp: z.string().optional(),
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', { config: { rateLimit: false } }, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const u = await q1('SELECT * FROM usuario WHERE lower(email) = lower($1)', [body.email]);
    if (!u || !u.ativo || !(await bcrypt.compare(body.senha, u.senha_hash))) {
      return reply.code(401).send({ erro: 'E-mail ou senha inválidos' });
    }
    // 2FA obrigatório para o síndico (acesso a câmeras): exige configuração antes de operar.
    if (u.totp_ativo) {
      if (!body.totp) return reply.code(401).send({ erro: 'Informe o código de 6 dígitos', precisaTotp: true });
      if (!authenticator.check(body.totp, u.totp_secret)) {
        return reply.code(401).send({ erro: 'Código inválido', precisaTotp: true });
      }
    }
    const perms = permissoesDe(u.papel, u.permissoes_extra);
    const token = app.jwt.sign({ sub: u.id, cid: u.condominio_id, papel: u.papel, perms, nome: u.nome });
    req.user = { sub: u.id, cid: u.condominio_id, papel: u.papel, perms, nome: u.nome };
    await audita(req, 'login');
    return {
      token,
      usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel, perms, totpAtivo: u.totp_ativo },
      avisoTotp: u.papel === 'sindico' && !u.totp_ativo ? 'Ative a verificação em duas etapas (obrigatória para o síndico).' : null,
    };
  });

  app.get('/auth/me', { preHandler: app.auth }, async (req) => {
    const u = await q1('SELECT id, nome, email, papel, totp_ativo FROM usuario WHERE id = $1', [req.user.sub]);
    const unidades = await q(
      `SELECT un.id, un.identificador, un.bloco, v.tipo FROM vinculo v JOIN unidade un ON un.id = v.unidade_id WHERE v.usuario_id = $1`,
      [req.user.sub],
    );
    return { ...u, perms: req.user.perms, unidades };
  });

  app.post('/auth/2fa/setup', { preHandler: app.auth }, async (req) => {
    const secret = authenticator.generateSecret();
    await q('UPDATE usuario SET totp_secret = $1, totp_ativo = false WHERE id = $2', [secret, req.user.sub]);
    const u = await q1('SELECT email FROM usuario WHERE id = $1', [req.user.sub]);
    return { secret, otpauth: authenticator.keyuri(u.email, 'Condominio App', secret) };
  });

  app.post('/auth/2fa/ativar', { preHandler: app.auth }, async (req, reply) => {
    const { codigo } = z.object({ codigo: z.string().length(6) }).parse(req.body);
    const u = await q1('SELECT totp_secret FROM usuario WHERE id = $1', [req.user.sub]);
    if (!u?.totp_secret || !authenticator.check(codigo, u.totp_secret)) {
      return reply.code(400).send({ erro: 'Código inválido' });
    }
    await q('UPDATE usuario SET totp_ativo = true WHERE id = $1', [req.user.sub]);
    await audita(req, '2fa.ativado');
    return { ok: true };
  });

  app.post('/auth/senha', { preHandler: app.auth }, async (req, reply) => {
    const b = z.object({ atual: z.string(), nova: z.string().min(8) }).parse(req.body);
    const u = await q1('SELECT senha_hash FROM usuario WHERE id = $1', [req.user.sub]);
    if (!(await bcrypt.compare(b.atual, u.senha_hash))) return reply.code(400).send({ erro: 'Senha atual incorreta' });
    await q('UPDATE usuario SET senha_hash = $1 WHERE id = $2', [await bcrypt.hash(b.nova, 10), req.user.sub]);
    await audita(req, 'senha.alterada');
    return { ok: true };
  });
}
