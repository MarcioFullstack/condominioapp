export type Papel = 'sindico' | 'subsindico' | 'tesoureiro' | 'conselho' | 'zelador' | 'morador';

export const TODAS_PERMISSOES = [
  'dashboard:ver',
  'financeiro:ver',
  'financeiro:lancar',
  'inadimplencia:ver',
  'cobranca:gerar',
  'solicitacao:ver_todas',
  'solicitacao:gerir',
  'cameras:ver',
  'usuarios:gerir',
  'auditoria:ver',
  'chat:avisos',
  'chat:moderar',
] as const;

export type Permissao = (typeof TODAS_PERMISSOES)[number];

const SEM_CAMERAS = TODAS_PERMISSOES.filter((p) => p !== 'cameras:ver' && p !== 'usuarios:gerir');

/** Permissões base por papel. Câmeras: SÓ o síndico (ou quem ele delegar em permissoes_extra). */
export const BASE: Record<Papel, readonly Permissao[]> = {
  sindico: TODAS_PERMISSOES,
  subsindico: SEM_CAMERAS,
  tesoureiro: ['dashboard:ver', 'financeiro:ver', 'financeiro:lancar', 'inadimplencia:ver', 'cobranca:gerar'],
  conselho: ['dashboard:ver', 'financeiro:ver', 'inadimplencia:ver'],
  zelador: ['solicitacao:ver_todas', 'solicitacao:gerir'],
  morador: [],
};

export function permissoesDe(papel: Papel, extras: string[] = []): string[] {
  return [...new Set([...BASE[papel], ...extras.filter((e) => (TODAS_PERMISSOES as readonly string[]).includes(e))])];
}
