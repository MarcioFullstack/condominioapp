import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { q, q1 } from '../db.js';
import { audita } from '../lib/audit.js';
import { emitirTokenCamera, validarTokenCamera } from '../lib/camtoken.js';
import { encrypt } from '../lib/crypto.js';
import { publicar } from '../lib/realtime.js';

export async function camerasRoutes(app: FastifyInstance) {
  // Todas as rotas de câmera exigem 'cameras:ver' (só o síndico, ou quem ele delegar).
  app.get('/cameras', { preHandler: app.exige('cameras:ver') }, async (req) =>
    q('SELECT id, nome, tipo, local, stream_name, online FROM camera WHERE condominio_id = $1 AND ativo ORDER BY tipo, nome', [req.user.cid]),
  );

  app.post('/cameras', { preHandler: app.exige('cameras:ver') }, async (req) => {
    const b = z
      .object({
        nome: z.string().min(2),
        tipo: z.enum(['externa', 'interna']),
        local: z.string().optional(),
        stream_name: z.string().regex(/^[a-z0-9_-]+$/i),
        rtsp_url: z.string().startsWith('rtsp://').optional(), // guardado cifrado; nunca retorna
      })
      .parse(req.body);
    const c = await q1(
      `INSERT INTO camera (condominio_id, nome, tipo, local, stream_name, rtsp_cifrado)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, nome, tipo, local, stream_name, online`,
      [req.user.cid, b.nome, b.tipo, b.local ?? null, b.stream_name, b.rtsp_url ? encrypt(b.rtsp_url) : null],
    );
    await audita(req, 'camera.criada', 'camera', c.id, { nome: b.nome, tipo: b.tipo });
    return c;
  });

  // Abre uma sessão de visualização: registra o acesso e devolve URL com token de poucos minutos.
  app.post('/cameras/:id/sessao', { preHandler: app.exige('cameras:ver') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const cam = await q1('SELECT id, stream_name, nome FROM camera WHERE id = $1 AND condominio_id = $2 AND ativo', [id, req.user.cid]);
    if (!cam) return reply.code(404).send({ erro: 'Câmera não encontrada' });
    const { token, exp } = emitirTokenCamera({ stream: cam.stream_name, uid: req.user.sub, cid: req.user.cid });
    await q('INSERT INTO camera_acesso_log (condominio_id, camera_id, usuario_id, ip) VALUES ($1,$2,$3,$4)', [req.user.cid, cam.id, req.user.sub, req.ip]);
    await audita(req, 'camera.visualizada', 'camera', cam.id, { nome: cam.nome });
    const base = config.GATEWAY_PUBLIC_URL.replace(/\/$/, '');
    const src = encodeURIComponent(cam.stream_name);
    return {
      hls: `${base}/api/stream.m3u8?src=${src}&token=${token}`,
      webrtc: `${base}/api/webrtc?src=${src}&token=${token}`,
      expira_em: exp,
    };
  });

  app.get('/cameras/log', { preHandler: app.exige('cameras:ver') }, async (req) =>
    q(
      `SELECT l.id, l.inicio, l.ip, c.nome AS camera, u.nome AS usuario
       FROM camera_acesso_log l JOIN camera c ON c.id = l.camera_id JOIN usuario u ON u.id = l.usuario_id
       WHERE l.condominio_id = $1 ORDER BY l.id DESC LIMIT 200`,
      [req.user.cid],
    ),
  );

  // ----- Chamado pelo proxy do gateway (nginx auth_request) -----
  // Valida o token curto (query ?token= ou cookie camtoken) e se ele vale para o stream pedido.
  app.get('/cameras/gateway/auth', async (req, reply) => {
    const original = String(req.headers['x-original-uri'] ?? '');
    const url = new URL(original || '/', 'http://gateway');
    const cookie = /(?:^|;\s*)camtoken=([^;]+)/.exec(String(req.headers.cookie ?? ''))?.[1];
    const token = url.searchParams.get('token') ?? cookie ?? '';
    const p = validarTokenCamera(token);
    const src = url.searchParams.get('src');
    // segmentos HLS não repetem ?src=, então o cookie vale só para o stream do token
    if (!p || (src && src !== p.stream)) return reply.code(401).send();
    return reply.code(204).send();
  });

  // ----- Agente do gateway informa quais streams estão online -----
  app.post('/cameras/heartbeat', async (req, reply) => {
    if (!config.GATEWAY_TOKEN || req.headers['x-gateway-token'] !== config.GATEWAY_TOKEN) {
      return reply.code(401).send({ erro: 'Token inválido' });
    }
    const b = z
      .object({ condominio_id: z.string().uuid(), streams: z.array(z.object({ nome: z.string(), online: z.boolean() })) })
      .parse(req.body);
    for (const s of b.streams) {
      const antes = await q1('SELECT id, nome, online FROM camera WHERE condominio_id = $1 AND stream_name = $2', [b.condominio_id, s.nome]);
      if (!antes || antes.online === s.online) continue;
      await q('UPDATE camera SET online = $1 WHERE id = $2', [s.online, antes.id]);
      publicar(b.condominio_id, 'camera.status', { id: antes.id, nome: antes.nome, online: s.online }, { perm: 'cameras:ver' });
    }
    return { ok: true };
  });
}
