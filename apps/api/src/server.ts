import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { q } from './db.js';
import { permissoesDe } from './lib/permissions.js';
import { entrar } from './lib/realtime.js';
import { setupAuth } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { cadastrosRoutes } from './routes/cadastros.js';
import { camerasRoutes } from './routes/cameras.js';
import { chatRoutes } from './routes/chat.js';
import { cobrancasRoutes } from './routes/cobrancas.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { financeiroRoutes } from './routes/financeiro.js';
import { solicitacoesRoutes } from './routes/solicitacoes.js';

mkdirSync(resolve(config.UPLOAD_DIR), { recursive: true });

const app = Fastify({ logger: { level: 'info' }, trustProxy: true });

await app.register(cors, { origin: config.WEB_ORIGIN.split(','), credentials: true });
await app.register(multipart);
await app.register(websocket);
await setupAuth(app);

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ erro: 'Dados inválidos', detalhes: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
  }
  const e = err as { statusCode?: number; message: string; code?: string };
  if (e.code === '23505') return reply.code(409).send({ erro: 'Registro duplicado' });
  if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ erro: e.message });
  app.log.error(err);
  return reply.code(500).send({ erro: 'Erro interno' });
});

app.get('/health', async () => ({ ok: true }));

// Tempo real: chat, painel, solicitações, cobranças. Autentica com o JWT na query (?token=).
app.get('/ws', { websocket: true }, async (socket, req) => {
  try {
    const { token } = req.query as { token?: string };
    const s = app.jwt.verify<{ sub: string; cid: string }>(token ?? '');
    const [u] = await q('SELECT ativo, papel, permissoes_extra FROM usuario WHERE id = $1', [s.sub]);
    if (!u?.ativo) throw new Error('inativo');
    entrar(s.cid, { ws: socket, userId: s.sub, perms: new Set(permissoesDe(u.papel, u.permissoes_extra)) });
    socket.send(JSON.stringify({ evento: 'conectado', dados: {} }));
  } catch {
    socket.close(4401, 'não autenticado');
  }
});

await app.register(authRoutes);
await app.register(cadastrosRoutes);
await app.register(financeiroRoutes);
await app.register(cobrancasRoutes);
await app.register(solicitacoesRoutes);
await app.register(chatRoutes);
await app.register(camerasRoutes);
await app.register(dashboardRoutes);

await app.listen({ port: config.PORT, host: '0.0.0.0' });
