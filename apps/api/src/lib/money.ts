/** Primeiro dia do mês de uma data 'YYYY-MM-DD' (competência). */
export function competenciaDe(data: string): string {
  return `${data.slice(0, 7)}-01`;
}

export function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function diasEntre(a: string, b: string): number {
  return Math.floor((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** Multa fixa + juros pro rata dia sobre o valor original. Tudo em centavos inteiros. */
export function encargos(valor: number, vencimento: string, ate: string, multaBps: number, jurosMensalBps: number) {
  const dias = diasEntre(vencimento, ate);
  if (dias <= 0) return { dias: 0, multa: 0, juros: 0, total: valor };
  const multa = Math.round((valor * multaBps) / 10_000);
  const juros = Math.round((valor * jurosMensalBps * dias) / (10_000 * 30));
  return { dias, multa, juros, total: valor + multa + juros };
}
