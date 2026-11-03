import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { brl, dataBR, mesAtual, mesBR, paraCentavos } from '../format';
import { useEvento } from '../realtime';
import { Selo, Titulo, Vazio, useAcao } from '../ui';

export default function Cobrancas() {
  const { pode } = useAuth();
  return pode('inadimplencia:ver', 'cobranca:gerar') ? <Admin /> : <Morador />;
}

function Morador() {
  const [lista, setLista] = useState<any[]>([]);
  const carregar = useCallback(() => { api.get('/minhas-cobrancas').then(setLista); }, []);
  useEffect(carregar, [carregar]);
  useEvento(['cobranca.nova', 'cobranca.paga'], carregar);

  return (
    <>
      <Titulo>Minhas taxas</Titulo>
      {lista.length === 0 && <Vazio>Nenhuma cobrança para a sua unidade.</Vazio>}
      {lista.map((c) => (
        <div key={c.id} className="card mb-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium capitalize">{mesBR(c.competencia.slice(0, 7))} · {c.unidade}</p>
              <p className="text-xs text-slate-500">Vencimento {dataBR(c.vencimento)}</p>
            </div>
            {c.status === 'paga' ? <Selo cor="verde">Paga em {dataBR(c.pago_em)}</Selo> : c.dias > 0 ? <Selo cor="vermelho">{c.dias} dias de atraso</Selo> : <Selo cor="azul">Em aberto</Selo>}
          </div>
          <p className="mt-2 text-xl font-semibold">{brl(c.status === 'paga' ? c.valor_pago_centavos : (c.total ?? c.valor_centavos))}</p>
          {c.status === 'aberta' && c.dias > 0 && (
            <p className="text-xs text-slate-500">Valor {brl(c.valor_centavos)} + multa {brl(c.multa)} + juros {brl(c.juros)}</p>
          )}
          {c.status === 'aberta' && c.psp_link && (
            <a className="btn mt-3 w-full" href={c.psp_link} target="_blank" rel="noreferrer">Pagar com Pix ou boleto</a>
          )}
          {c.status === 'aberta' && !c.psp_link && <p className="mt-2 text-xs text-slate-500">Pagamento combinado diretamente com a administração.</p>}
        </div>
      ))}
    </>
  );
}

function Admin() {
  const { pode } = useAuth();
  const [inad, setInad] = useState<any>(null);
  const [cobs, setCobs] = useState<any[]>([]);
  const [mes, setMes] = useState(mesAtual());
  const [msg, setMsg] = useState('');
  const gerar = useAcao();

  const carregar = useCallback(async () => {
    const [i, c] = await Promise.all([
      pode('inadimplencia:ver') ? api.get('/inadimplencia') : Promise.resolve(null),
      api.get(`/cobrancas?competencia=${mes}`),
    ]);
    setInad(i);
    setCobs(c);
  }, [mes]); // eslint-disable-line
  useEffect(() => { carregar(); }, [carregar]);
  useEvento(['cobranca.paga', 'cobranca.nova'], carregar);

  const baixar = async (c: any) => {
    const v = prompt(`Valor recebido da ${c.unidade} (R$):`, (c.valor_centavos / 100).toFixed(2).replace('.', ','));
    if (!v) return;
    const centavos = paraCentavos(v);
    if (!(centavos > 0)) return alert('Valor inválido');
    try { await api.post(`/cobrancas/${c.id}/baixa-manual`, { valor_pago_centavos: centavos }); carregar(); } catch (e) { alert((e as Error).message); }
  };

  return (
    <>
      <Titulo>Cobranças</Titulo>

      {inad && (
        <section className="mb-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="card"><p className="label">Inadimplentes</p><p className="text-lg font-semibold">{inad.unidades_inadimplentes}</p></div>
            <div className="card"><p className="label">% unidades</p><p className="text-lg font-semibold">{inad.percentual}%</p></div>
            <div className="card"><p className="label">Em aberto</p><p className="text-base font-semibold">{brl(inad.total_em_aberto_centavos)}</p></div>
          </div>
          {inad.unidades.length > 0 && (
            <div className="card mt-3 divide-y divide-slate-100 !p-0">
              {inad.unidades.map((u: any) => (
                <div key={u.unidade_id} className="flex items-center justify-between p-3">
                  <div>
                    <p className="text-sm font-medium">{u.unidade}</p>
                    <p className="text-xs text-slate-500">{u.cobrancas.length} cobrança(s) · até {u.max_dias} dias de atraso</p>
                  </div>
                  <Selo cor="vermelho">{brl(u.total_centavos)}</Selo>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {pode('cobranca:gerar') && (
        <section className="card mb-4">
          <h2 className="mb-2 text-sm font-semibold">Gerar taxa do mês</h2>
          <div className="flex gap-2">
            <input type="month" className="input" value={mes} onChange={(e) => setMes(e.target.value)} />
            <button className="btn whitespace-nowrap" disabled={gerar.ocupado}
              onClick={() => gerar.rodar(async () => {
                const r = await api.post('/cobrancas/gerar', { competencia: mes });
                setMsg(`${r.criadas} cobrança(s) criada(s) (${r.modoPsp === 'asaas' ? 'com Pix/boleto' : 'modo manual'})${r.falhasPsp.length ? ` · ${r.falhasPsp.length} falha(s) no PSP` : ''}`);
                carregar();
              })}>Gerar</button>
          </div>
          {msg && <p className="mt-2 text-sm text-emerald-700">{msg}</p>}
          {gerar.erro && <p className="mt-2 text-sm text-red-700">{gerar.erro}</p>}
        </section>
      )}

      <h2 className="mb-1 text-sm font-semibold capitalize">Cobranças de {mesBR(mes)}</h2>
      {cobs.length === 0 && <Vazio>Nenhuma cobrança neste mês.</Vazio>}
      <div className="card divide-y divide-slate-100 !p-0">
        {cobs.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 p-3">
            <div>
              <p className="text-sm font-medium">{c.unidade}</p>
              <p className="text-xs text-slate-500">Vence {dataBR(c.vencimento)} · {brl(c.valor_centavos)}</p>
            </div>
            <div className="flex items-center gap-2">
              {c.status === 'paga' ? <Selo cor="verde">Paga</Selo> : <Selo cor="amarelo">Aberta</Selo>}
              {c.status === 'aberta' && pode('financeiro:lancar') && <button className="btn-ghost !py-0.5 text-xs" onClick={() => baixar(c)}>Dar baixa</button>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
