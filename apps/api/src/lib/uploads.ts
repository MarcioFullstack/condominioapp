import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { config } from '../config.js';

export const MIMES_ANEXO = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

/** Salva o arquivo multipart em UPLOAD_DIR/<condominio>/<pasta>/<uuid>.<ext>. Retorna o caminho relativo. */
export async function salvarUpload(req: FastifyRequest, pasta: 'chat' | 'solic') {
  const file = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
  if (!file) return { erro: 'Envie um arquivo' as const };
  if (!MIMES_ANEXO.has(file.mimetype)) return { erro: 'Use JPG, PNG, WEBP ou PDF' as const };
  const buf = await file.toBuffer();
  if (file.file.truncated) return { erro: 'Arquivo acima de 10 MB' as const };
  const rel = join(req.user.cid, pasta, `${randomUUID()}${extname(file.filename).toLowerCase().slice(0, 6)}`);
  await mkdir(resolve(config.UPLOAD_DIR, req.user.cid, pasta), { recursive: true });
  await writeFile(resolve(config.UPLOAD_DIR, rel), buf);
  return { rel, mime: file.mimetype, nome: file.filename };
}
