import { config } from '../config.js';

export interface PagadorPSP {
  nome: string;
  cpfCnpj: string;
  customerId?: string | null;
}

export interface CobrancaPSP {
  id: string;
  link: string;
  customerId: string;
}

export function pspAtivo(): boolean {
  return config.PSP_PROVIDER === 'asaas' && !!config.ASAAS_API_KEY;
}

async function asaas<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${config.ASAAS_BASE_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', access_token: config.ASAAS_API_KEY, 'User-Agent': 'condominio-app' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Asaas ${r.status}: ${txt.slice(0, 300)}`);
  return JSON.parse(txt) as T;
}

/** Cria cobrança Pix/boleto (billingType UNDEFINED deixa o pagador escolher na fatura). */
export async function criarCobrancaPSP(p: {
  pagador: PagadorPSP;
  valorCentavos: number;
  vencimento: string; // YYYY-MM-DD
  descricao: string;
  referencia: string; // id local da cobrança
}): Promise<CobrancaPSP> {
  let customerId = p.pagador.customerId;
  if (!customerId) {
    const c = await asaas<{ id: string }>('/customers', { name: p.pagador.nome, cpfCnpj: p.pagador.cpfCnpj });
    customerId = c.id;
  }
  const pay = await asaas<{ id: string; invoiceUrl: string }>('/payments', {
    customer: customerId,
    billingType: 'UNDEFINED',
    value: p.valorCentavos / 100,
    dueDate: p.vencimento,
    description: p.descricao,
    externalReference: p.referencia,
  });
  return { id: pay.id, link: pay.invoiceUrl, customerId };
}
