import type { WebSocket } from 'ws';

interface Cliente {
  ws: WebSocket;
  userId: string;
  perms: Set<string>;
}

const salas = new Map<string, Set<Cliente>>();

export function entrar(condominioId: string, c: Cliente) {
  if (!salas.has(condominioId)) salas.set(condominioId, new Set());
  salas.get(condominioId)!.add(c);
  c.ws.on('close', () => salas.get(condominioId)?.delete(c));
}

interface Alvo {
  /** só quem tem esta permissão recebe */
  perm?: string;
  /** só estes usuários recebem */
  usuarios?: string[];
}

/** Envia um evento em tempo real para os conectados do condomínio. */
export function publicar(condominioId: string, evento: string, dados: unknown, alvo: Alvo = {}) {
  const msg = JSON.stringify({ evento, dados });
  for (const c of salas.get(condominioId) ?? []) {
    if (alvo.perm && !c.perms.has(alvo.perm)) continue;
    if (alvo.usuarios && !alvo.usuarios.includes(c.userId)) continue;
    if (c.ws.readyState === 1) c.ws.send(msg);
  }
}

/** Avisa quem pode ver o painel para recarregar os indicadores. */
export function atualizarPainel(condominioId: string) {
  publicar(condominioId, 'dashboard.atualizar', {}, { perm: 'dashboard:ver' });
}
