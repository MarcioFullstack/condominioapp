import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { q, q1 } from '../db.js';
import { publicar } from '../lib/realtime.js';
import { salvarUpload } from '../lib/uploads.js';

/** Canais gerais são de todo o condomínio; DMs só dos dois participantes. */
async function canalAcessivel(cid: string, userId: string, canalId: string) {
  return q1(
    `SELECT c.* FROM canal c
     WHERE c.id = $1 AND c.condominio_id = $2
       AND (c.tipo <> 'dm' OR EXISTS (SELECT 1 FROM canal_membro m WHERE m.canal_id = c.id AND m.usuario_id = $3))`,
    [canalId, cid, userId],
  );
}

export async function chatRoutes(app: FastifyInstance) {
  app.get('/chat/canais', { preHandler: app.auth }, async (req) =>
    q(
      `SELECT c.id, c.slug, c.nome, c.tipo, c.somente_sindico_escreve,
              CASE WHEN c.tipo = 'dm' THEN (SELECT u.nome FROM canal_membro m JOIN usuario u ON u.id = m.usuario_id
                                            WHERE m.canal_id = c.id AND m.usuario_id <> $2 LIMIT 1) ELSE c.nome END AS titulo,
              (SELECT count(*)::int FROM mensagem m WHERE m.canal_id = c.id AND m.usuario_id <> $2
                 AND NOT EXISTS (SELECT 1 FROM leitura_mensagem l WHERE l.mensagem_id = m.id AND l.usuario_id = $2)) AS nao_lidas
       FROM canal c
       WHERE c.condominio_id = $1
         AND (c.tipo <> 'dm' OR EXISTS (SELECT 1 FROM canal_membro m WHERE m.canal_id = c.id AND m.usuario_id = $2))
       ORDER BY (c.tipo = 'dm'), c.nome`,
      [req.user.cid, req.user.sub],
    ),
  );

  app.get('/chat/pessoas', { preHandler: app.auth }, async (req) =>
    q('SELECT id, nome FROM usuario WHERE condominio_id = $1 AND ativo AND id <> $2 ORDER BY nome', [req.user.cid, req.user.sub]),
  );

  app.post('/chat/dm', { preHandler: app.auth }, async (req, reply) => {
    const { usuario_id } = z.object({ usuario_id: z.string().uuid() }).parse(req.body);
    const outro = await q1('SELECT id FROM usuario WHERE id = $1 AND condominio_id = $2 AND ativo', [usuario_id, req.user.cid]);
    if (!outro || outro.id === req.user.sub) return reply.code(400).send({ erro: 'Usuário inválido' });
    const slug = `dm:${[req.user.sub, usuario_id].sort().join(':')}`;
    let c = await q1('SELECT id FROM canal WHERE condominio_id = $1 AND slug = $2', [req.user.cid, slug]);
    if (!c) {
      c = await q1("INSERT INTO canal (condominio_id, slug, nome, tipo) VALUES ($1,$2,'Conversa direta','dm') RETURNING id", [req.user.cid, slug]);
      await q('INSERT INTO canal_membro (canal_id, usuario_id) VALUES ($1,$2),($1,$3)', [c.id, req.user.sub, usuario_id]);
    }
    return c;
  });

  app.get('/chat/canais/:id/mensagens', { preHandler: app.auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const f = z.object({ antes: z.string().datetime().optional(), limite: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    const canal = await canalAcessivel(req.user.cid, req.user.sub, id);
    if (!canal) return reply.code(404).send({ erro: 'Canal não encontrado' });
    const rows = await q(
      `SELECT m.id, m.texto, m.anexo, m.responde_a, m.created_at, u.id AS usuario_id, u.nome AS autor, u.papel,
              (SELECT count(*)::int FROM leitura_mensagem l WHERE l.mensagem_id = m.id) AS leituras
       FROM mensagem m JOIN usuario u ON u.id = m.usuario_id
       WHERE m.canal_id = $1 AND ($2::timestamptz IS NULL OR m.created_at < $2)
       ORDER BY m.created_at DESC LIMIT $3`,
      [id, f.antes ?? null, f.limite],
    );
    return rows.reverse();
  });

  app.post('/chat/canais/:id/mensagens', { preHandler: app.auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ texto: z.string().min(1).max(4000), responde_a: z.string().uuid().optional(), anexo: z.string().optional() }).parse(req.body);
    const canal = await canalAcessivel(req.user.cid, req.user.sub, id);
    if (!canal) return reply.code(404).send({ erro: 'Canal não encontrado' });
    if (canal.somente_sindico_escreve && !req.user.perms.includes('chat:avisos')) {
      return reply.code(403).send({ erro: 'Só a administração escreve neste canal' });
    }
    if (b.anexo && !b.anexo.startsWith(`${req.user.cid}/chat/`)) return reply.code(400).send({ erro: 'Anexo inválido' });
    const m = await q1(
      'INSERT INTO mensagem (canal_id, usuario_id, texto, anexo, responde_a) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [id, req.user.sub, b.texto, b.anexo ?? null, b.responde_a ?? null],
    );
    const payload = { ...m, autor: req.user.nome, papel: req.user.papel, usuario_id: req.user.sub, leituras: 0 };
    if (canal.tipo === 'dm') {
      const membros = await q('SELECT usuario_id FROM canal_membro WHERE canal_id = $1', [id]);
      publicar(req.user.cid, 'mensagem.nova', payload, { usuarios: membros.map((x) => x.usuario_id) });
    } else {
      publicar(req.user.cid, 'mensagem.nova', payload);
    }
    return m;
  });

  // Confirmação de leitura (avisos oficiais)
  app.post('/chat/canais/:id/lido', { preHandler: app.auth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canalAcessivel(req.user.cid, req.user.sub, id))) return reply.code(404).send({ erro: 'Canal não encontrado' });
    await q(
      `INSERT INTO leitura_mensagem (mensagem_id, usuario_id)
       SELECT m.id, $2 FROM mensagem m WHERE m.canal_id = $1 AND m.usuario_id <> $2 ON CONFLICT DO NOTHING`,
      [id, req.user.sub],
    );
    return { ok: true };
  });

  app.delete('/chat/mensagens/:id', { preHandler: app.exige('chat:moderar') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await q1(
      `DELETE FROM mensagem m USING canal c WHERE m.id = $1 AND c.id = m.canal_id AND c.condominio_id = $2 AND c.tipo <> 'dm' RETURNING m.id, m.canal_id`,
      [id, req.user.cid],
    );
    if (!r) return reply.code(404).send({ erro: 'Mensagem não encontrada' });
    publicar(req.user.cid, 'mensagem.removida', { id, canal_id: r.canal_id });
    return { ok: true };
  });

  // ---------- Arquivos (chat e solicitações) ----------
  app.post('/chat/upload', { preHandler: app.auth }, async (req, reply) => {
    const r = await salvarUpload(req, 'chat');
    if ('erro' in r) return reply.code(400).send({ erro: r.erro });
    return { arquivo: r.rel };
  });

  // Download autenticado, restrito ao próprio condomínio.
  app.get('/arquivos/*', { preHandler: app.auth }, async (req, reply) => {
    const rel = (req.params as { '*': string })['*'];
    const abs = resolve(config.UPLOAD_DIR, rel);
    const base = resolve(config.UPLOAD_DIR, req.user.cid);
    if (!abs.startsWith(base + '/') || !/\/(chat|solic)\//.test(rel) || !existsSync(abs)) {
      return reply.code(404).send({ erro: 'Arquivo não encontrado' });
    }
    const ext = abs.slice(abs.lastIndexOf('.')).toLowerCase();
    const tipo = ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' } as Record<string, string>)[ext] ?? 'application/octet-stream';
    return reply.type(tipo).send(createReadStream(abs));
  });
}
