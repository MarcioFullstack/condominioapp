import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { q, q1, tx } from '../db.js';
import { TODAS_PERMISSOES } from '../lib/permissions.js';
import { audita } from '../lib/audit.js';

const papeis = ['sindico', 'subsindico', 'tesoureiro', 'conselho', 'zelador', 'morador'] as const;

export async function cadastrosRoutes(app: FastifyInstance) {
  // ---------- Unidades ----------
  app.get('/unidades', { preHandler: app.exige('usuarios:gerir', 'financeiro:ver') }, async (req) =>
    q(
      `SELECT un.*, COALESCE(json_agg(json_build_object('id', u.id, 'nome', u.nome, 'tipo', v.tipo)) FILTER (WHERE u.id IS NOT NULL), '[]') AS moradores
       FROM unidade un
       LEFT JOIN vinculo v ON v.unidade_id = un.id
       LEFT JOIN usuario u ON u.id = v.usuario_id
       WHERE un.condominio_id = $1 GROUP BY un.id ORDER BY un.identificador`,
      [req.user.cid],
    ),
  );

  app.post('/unidades', { preHandler: app.exige('usuarios:gerir') }, async (req) => {
    const b = z
      .object({ identificador: z.string().min(1), bloco: z.string().optional(), taxa_centavos: z.number().int().min(0).default(0) })
      .parse(req.body);
    const u = await q1(
      'INSERT INTO unidade (condominio_id, identificador, bloco, taxa_centavos) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user.cid, b.identificador, b.bloco ?? null, b.taxa_centavos],
    );
    await audita(req, 'unidade.criada', 'unidade', u.id, b);
    return u;
  });

  app.patch('/unidades/:id', { preHandler: app.exige('usuarios:gerir') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({
        taxa_centavos: z.number().int().min(0).optional(),
        bloco: z.string().optional(),
        responsavel_nome: z.string().optional(),
        responsavel_cpf_cnpj: z.string().regex(/^\d{11}$|^\d{14}$/, 'Somente dígitos (CPF 11 / CNPJ 14)').optional(),
      })
      .parse(req.body);
    const u = await q1(
      `UPDATE unidade SET taxa_centavos = COALESCE($1, taxa_centavos), bloco = COALESCE($2, bloco),
              responsavel_nome = COALESCE($5, responsavel_nome), responsavel_cpf_cnpj = COALESCE($6, responsavel_cpf_cnpj)
       WHERE id = $3 AND condominio_id = $4 RETURNING id, identificador, bloco, taxa_centavos, responsavel_nome`,
      [b.taxa_centavos ?? null, b.bloco ?? null, id, req.user.cid, b.responsavel_nome ?? null, b.responsavel_cpf_cnpj ?? null],
    );
    if (!u) return reply.code(404).send({ erro: 'Unidade não encontrada' });
    await audita(req, 'unidade.alterada', 'unidade', id, b);
    return u;
  });

  // ---------- Usuários ----------
  app.get('/usuarios', { preHandler: app.exige('usuarios:gerir') }, async (req) =>
    q(
      `SELECT u.id, u.nome, u.email, u.telefone, u.papel, u.permissoes_extra, u.ativo, u.totp_ativo,
              COALESCE(json_agg(json_build_object('id', un.id, 'identificador', un.identificador)) FILTER (WHERE un.id IS NOT NULL), '[]') AS unidades
       FROM usuario u
       LEFT JOIN vinculo v ON v.usuario_id = u.id
       LEFT JOIN unidade un ON un.id = v.unidade_id
       WHERE u.condominio_id = $1 GROUP BY u.id ORDER BY u.nome`,
      [req.user.cid],
    ),
  );

  app.post('/usuarios', { preHandler: app.exige('usuarios:gerir') }, async (req, reply) => {
    const b = z
      .object({
        nome: z.string().min(2),
        email: z.string().email(),
        telefone: z.string().optional(),
        senha: z.string().min(8),
        papel: z.enum(papeis),
        unidade_id: z.string().uuid().optional(),
        vinculo: z.enum(['proprietario', 'inquilino', 'dependente']).default('proprietario'),
      })
      .parse(req.body);
    if (await q1('SELECT 1 FROM usuario WHERE lower(email) = lower($1)', [b.email])) {
      return reply.code(409).send({ erro: 'E-mail já cadastrado' });
    }
    const hash = await bcrypt.hash(b.senha, 10);
    const novo = await tx(async (c) => {
      const r = await c.query(
        `INSERT INTO usuario (condominio_id, nome, email, telefone, senha_hash, papel)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, nome, email, papel`,
        [req.user.cid, b.nome, b.email, b.telefone ?? null, hash, b.papel],
      );
      const u = r.rows[0];
      if (b.unidade_id) {
        await c.query(
          `INSERT INTO vinculo (usuario_id, unidade_id, tipo)
           SELECT $1, id, $3 FROM unidade WHERE id = $2 AND condominio_id = $4`,
          [u.id, b.unidade_id, b.vinculo, req.user.cid],
        );
      }
      // entra nos canais gerais
      await c.query(
        `INSERT INTO canal_membro (canal_id, usuario_id) SELECT id, $1 FROM canal WHERE condominio_id = $2 AND tipo <> 'dm'`,
        [u.id, req.user.cid],
      );
      return u;
    });
    await audita(req, 'usuario.criado', 'usuario', novo.id, { papel: b.papel });
    return novo;
  });

  app.patch('/usuarios/:id', { preHandler: app.exige('usuarios:gerir') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({
        ativo: z.boolean().optional(),
        papel: z.enum(papeis).optional(),
        // delegações explícitas do síndico (ex.: liberar câmeras ao subsíndico)
        permissoes_extra: z.array(z.enum(TODAS_PERMISSOES)).optional(),
      })
      .parse(req.body);
    const u = await q1(
      `UPDATE usuario SET ativo = COALESCE($1, ativo), papel = COALESCE($2::papel, papel),
              permissoes_extra = COALESCE($3, permissoes_extra)
       WHERE id = $4 AND condominio_id = $5 RETURNING id, nome, papel, ativo, permissoes_extra`,
      [b.ativo ?? null, b.papel ?? null, b.permissoes_extra ?? null, id, req.user.cid],
    );
    if (!u) return reply.code(404).send({ erro: 'Usuário não encontrado' });
    await audita(req, 'usuario.alterado', 'usuario', id, b);
    return u;
  });

  app.post('/usuarios/:id/vinculos', { preHandler: app.exige('usuarios:gerir') }, async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ unidade_id: z.string().uuid(), tipo: z.enum(['proprietario', 'inquilino', 'dependente']).default('proprietario') }).parse(req.body);
    await q(
      `INSERT INTO vinculo (usuario_id, unidade_id, tipo)
       SELECT u.id, un.id, $3 FROM usuario u, unidade un
       WHERE u.id = $1 AND un.id = $2 AND u.condominio_id = $4 AND un.condominio_id = $4
       ON CONFLICT DO NOTHING`,
      [id, b.unidade_id, b.tipo, req.user.cid],
    );
    await audita(req, 'vinculo.criado', 'usuario', id, b);
    return { ok: true };
  });

  // ---------- Condomínio ----------
  app.get('/condominio', { preHandler: app.auth }, async (req) =>
    q1('SELECT id, nome, multa_bps, juros_mensal_bps, dia_vencimento FROM condominio WHERE id = $1', [req.user.cid]),
  );

  // ---------- Auditoria ----------
  app.get('/auditoria', { preHandler: app.exige('auditoria:ver') }, async (req) =>
    q(
      `SELECT a.id, a.acao, a.entidade, a.entidade_id, a.dados, a.ip, a.created_at, u.nome AS usuario
       FROM auditoria a LEFT JOIN usuario u ON u.id = a.usuario_id
       WHERE a.condominio_id = $1 ORDER BY a.id DESC LIMIT 200`,
      [req.user.cid],
    ),
  );
}
