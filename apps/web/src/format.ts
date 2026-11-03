export const brl = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** "1.234,56" | "1234.56" | "50" → centavos inteiros (nunca float no envio). */
export function paraCentavos(texto: string): number {
  const t = texto.trim().replace(/[R$\s]/g, '');
  if (!t) return NaN;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normal);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

export const dataBR = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
export const dataHoraBR = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
export const mesBR = (ym: string) => {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
};
export const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const mesAtual = () => hojeISO().slice(0, 7);

export const STATUS_SOLICITACAO: Record<string, string> = {
  aberta: 'Aberta',
  em_analise: 'Em análise',
  em_execucao: 'Em execução',
  concluida: 'Concluída',
  recusada: 'Recusada',
};
export const TIPO_SOLICITACAO: Record<string, string> = {
  manutencao: 'Manutenção',
  reclamacao: 'Reclamação',
  sugestao: 'Sugestão',
  segunda_via_boleto: '2ª via de boleto',
  autorizacao_obra: 'Autorização de obra/mudança',
  reserva_area: 'Reserva de área comum',
  outros: 'Outros',
};
