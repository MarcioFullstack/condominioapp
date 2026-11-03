import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { brl, dataBR, mesBR } from '../format';
import { useEvento } from '../realtime';
import { Selo, Titulo } from '../ui';

export default function Dashboard() {
  const [d, setD] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [agora, setAgora] = useState<Date | null>(null);

  const carregar = useCallback(() => {
    api.get('/dashboard').then((r) => { setD(r); setAgora(new Date()); }).catch((e) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);

  // Qualquer evento que muda números do painel recarrega os indicadores na hora.
  useEvento(['dashboard.atualizar', 'camera.status'], carregar);

  if (erro) return <p className="text-red-600">{erro}</p>;
  if (!d) return <p className="text-slate-500">Carregando…</p>;

  const caixa = d.saldos.find((s: any) => s.tipo === 'caixa');
  const reserva = d.saldos.find((s: any) => s.tipo === 'fundo_reserva');
  const despesas = d.mes.por_categoria.filter((c: any) => c.tipo === 'despesa' && c.total_centavos > 0);
  const maior = Math.max(1, ...despesas.map((c: any) => c.total_centavos));

  return (
    <>
      <Titulo acao={<span className="text-xs text-emerald-600">● ao vivo {agora?.toLocaleTimeString('pt-BR')}</span>}>Painel</Titulo>

      <div className="grid grid-cols-2 gap-3">
        <div className="card">
          <p className="label">Saldo em caixa</p>
          <p className="text-xl font-semibold">{brl(caixa?.saldo_centavos ?? 0)}</p>
        </div>
        <div className="card">
          <p className="label">Fundo de reserva</p>
          <p className="text-xl font-semibold">{brl(reserva?.saldo_centavos ?? 0)}</p>
        </div>
        <div className="card">
          <p className="label">Receitas · {mesBR(d.competencia)}</p>
          <p className="text-lg font-semibold text-emerald-700">{brl(d.mes.receitas_centavos)}</p>
        </div>
        <div className="card">
          <p className="label">Despesas · {mesBR(d.competencia)}</p>
          <p className="text-lg font-semibold text-red-700">{brl(d.mes.despesas_centavos)}</p>
        </div>
        {d.inadimplencia && (
          <div className="card col-span-2">
            <p className="label">Inadimplência</p>
            <p className="text-lg font-semibold">
              {brl(d.inadimplencia.total_centavos)}{' '}
              <span className="text-sm font-normal text-slate-500">
                · {d.inadimplencia.unidades} unidade(s) · {d.inadimplencia.percentual}%
              </span>
            </p>
          </div>
        )}
        <div className="card">
          <p className="label">Pedidos aguardando</p>
          <p className="text-lg font-semibold">{d.solicitacoes.aguardando}</p>
          <p className="text-xs text-slate-500">{d.solicitacoes.em_execucao} em execução</p>
        </div>
        {d.cameras && (
          <div className="card">
            <p className="label">Câmeras</p>
            <p className="text-lg font-semibold">
              <span className="text-emerald-700">{d.cameras.online} on</span>{' '}
              <span className={d.cameras.offline ? 'text-red-700' : 'text-slate-400'}>{d.cameras.offline} off</span>
            </p>
          </div>
        )}
      </div>

      {despesas.length > 0 && (
        <section className="card mt-3">
          <h2 className="mb-2 text-sm font-semibold">Despesas do mês por categoria</h2>
          {despesas.map((c: any) => (
            <div key={c.categoria} className="mb-2">
              <div className="flex justify-between text-xs">
                <span>{c.categoria}</span>
                <span>{brl(c.total_centavos)}</span>
              </div>
              <div className="h-2 rounded bg-slate-100">
                <div className="h-2 rounded bg-red-400" style={{ width: `${(c.total_centavos / maior) * 100}%` }} />
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card mt-3">
        <h2 className="mb-2 text-sm font-semibold">Últimas movimentações</h2>
        {d.ultimas.length === 0 && <p className="text-sm text-slate-500">Nenhum lançamento ainda.</p>}
        {d.ultimas.map((l: any) => (
          <div key={l.id} className="flex items-center justify-between border-t border-slate-100 py-2 first:border-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{l.descricao}</p>
              <p className="text-xs text-slate-500">
                {dataBR(l.data_pagamento)} · {l.categoria}
                {l.unidade ? ` · ${l.unidade}` : ''} {l.tem_comprovante && '📎'}
              </p>
            </div>
            <Selo cor={l.tipo === 'entrada' ? 'verde' : 'vermelho'}>
              {l.tipo === 'entrada' ? '+' : '−'} {brl(l.valor_centavos)}
            </Selo>
          </div>
        ))}
      </section>
    </>
  );
}
