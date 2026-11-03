import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { abrirArquivo, api } from '../api';
import { useAuth } from '../auth';
import { brl, dataBR, hojeISO, mesAtual, mesBR, paraCentavos } from '../format';
import { useEvento } from '../realtime';
import { Campo, Erro, Modal, Selo, Titulo, Vazio, useAcao } from '../ui';

export default function Lancamentos() {
  const { pode } = useAuth();
  const [mes, setMes] = useState(mesAtual());
  const [lista, setLista] = useState<any[]>([]);
  const [saldos, setSaldos] = useState<any[]>([]);
  const [novo, setNovo] = useState(false);
  const [relatorio, setRelatorio] = useState<any>(null);

  const carregar = useCallback(async () => {
    const [l, s] = await Promise.all([api.get(`/lancamentos?competencia=${mes}`), api.get('/contas/saldos')]);
    setLista(l);
    setSaldos(s);
  }, [mes]);
  useEffect(() => { carregar(); }, [carregar]);
  useEvento(['lancamento.criado'], carregar);

  // Agrupa por categoria, como na planilha original.
  const grupos = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const l of lista) m.set(l.categoria, [...(m.get(l.categoria) ?? []), l]);
    return [...m.entries()];
  }, [lista]);

  const estornar = async (l: any) => {
    const motivo = prompt(`Motivo do estorno de "${l.descricao}":`);
    if (!motivo) return;
    try { await api.post(`/lancamentos/${l.id}/estorno`, { motivo }); carregar(); } catch (e) { alert((e as Error).message); }
  };

  const verRelatorio = async () => setRelatorio(await api.get(`/relatorios/mensal?competencia=${mes}`));

  return (
    <>
      <Titulo acao={<input type="month" className="input !w-auto" value={mes} onChange={(e) => setMes(e.target.value)} />}>Caixa</Titulo>

      <div className="mb-3 grid grid-cols-2 gap-3">
        {saldos.map((s) => (
          <div key={s.id} className="card">
            <p className="label">{s.nome}</p>
            <p className="text-lg font-semibold">{brl(s.saldo_centavos)}</p>
          </div>
        ))}
      </div>
      <button className="btn-ghost mb-3" onClick={verRelatorio}>Prestação de contas de {mesBR(mes)}</button>

      {grupos.length === 0 && <Vazio>Nenhum lançamento em {mesBR(mes)}.</Vazio>}
      {grupos.map(([cat, itens]) => (
        <section key={cat} className="mb-3">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-700">
            {cat} <span className="rounded bg-slate-200 px-1.5 text-xs">{itens.length}</span>
          </h2>
          <div className="card divide-y divide-slate-100 !p-0">
            {itens.map((l) => (
              <div key={l.id} className={`p-3 ${l.estornado || l.estorno_de ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{l.descricao}</p>
                    <p className="text-xs text-slate-500">
                      {dataBR(l.data_pagamento)} · {l.favorecido ?? '—'}
                      {l.unidade ? ` · ${l.unidade}` : ''} · {l.conta === 'fundo_reserva' ? 'Fundo de reserva' : 'Caixa'}
                    </p>
                  </div>
                  <Selo cor={l.tipo === 'entrada' ? 'verde' : 'vermelho'}>
                    {l.tipo === 'entrada' ? '+' : '−'} {brl(l.valor_centavos)}
                  </Selo>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {l.comprovantes.map((c: any) => (
                    <button key={c.id} className="btn-ghost !py-0.5 text-xs" onClick={() => abrirArquivo(`/comprovantes/${c.id}`)}>📎 Comprovante</button>
                  ))}
                  {l.estornado && <Selo cor="amarelo">Estornado</Selo>}
                  {l.estorno_de && <Selo cor="amarelo">Estorno</Selo>}
                  {pode('financeiro:lancar') && !l.estornado && !l.estorno_de && (
                    <button className="ml-auto text-xs text-red-600 underline" onClick={() => estornar(l)}>Estornar</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {pode('financeiro:lancar') && (
        <button onClick={() => setNovo(true)} aria-label="Novo lançamento"
          className="fixed bottom-24 right-5 z-20 h-14 w-14 rounded-full bg-brand text-3xl text-white shadow-lg">+</button>
      )}
      {novo && <NovoLancamento onClose={() => setNovo(false)} onSalvo={() => { setNovo(false); carregar(); }} />}

      {relatorio && (
        <Modal titulo={`Prestação de contas · ${mesBR(relatorio.competencia)}`} onClose={() => setRelatorio(null)}>
          <dl className="mb-3 grid grid-cols-2 gap-2 text-sm">
            <dt>Saldo anterior</dt><dd className="text-right">{brl(relatorio.saldo_anterior_centavos)}</dd>
            <dt>Receitas</dt><dd className="text-right text-emerald-700">{brl(relatorio.receitas_centavos)}</dd>
            <dt>Despesas</dt><dd className="text-right text-red-700">{brl(relatorio.despesas_centavos)}</dd>
            <dt className="font-semibold">Saldo final</dt><dd className="text-right font-semibold">{brl(relatorio.saldo_final_centavos)}</dd>
          </dl>
          {relatorio.por_categoria.map((c: any) => (
            <div key={c.categoria + c.tipo} className="flex justify-between border-t border-slate-100 py-1 text-sm">
              <span>{c.categoria} <span className="text-xs text-slate-400">({c.tipo})</span></span>
              <span>{brl(c.total_centavos)}</span>
            </div>
          ))}
          <button className="btn-ghost mt-3" onClick={() => window.print()}>Imprimir / salvar PDF</button>
        </Modal>
      )}
    </>
  );
}

function NovoLancamento({ onClose, onSalvo }: { onClose: () => void; onSalvo: () => void }) {
  const [tipo, setTipo] = useState<'entrada' | 'saida'>('saida');
  const [cats, setCats] = useState<any[]>([]);
  const [categoria, setCategoria] = useState('');
  const [valor, setValor] = useState('');
  const [descricao, setDescricao] = useState('');
  const [favorecido, setFavorecido] = useState('');
  const [data, setData] = useState(hojeISO());
  const [conta, setConta] = useState('caixa');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const { ocupado, erro, rodar, setErro } = useAcao();

  useEffect(() => { api.get('/categorias').then(setCats); }, []);
  const doTipo = cats.filter((c) => c.tipo === (tipo === 'entrada' ? 'receita' : 'despesa'));
  useEffect(() => setCategoria(doTipo[0]?.id ?? ''), [tipo, cats.length]); // eslint-disable-line

  const salvar = (e: FormEvent) => {
    e.preventDefault();
    const centavos = paraCentavos(valor);
    if (!(centavos > 0)) return setErro('Informe um valor válido');
    rodar(async () => {
      const l = await api.post('/lancamentos', { tipo, categoria_id: categoria, conta, valor_centavos: centavos, descricao, favorecido: favorecido || undefined, data_pagamento: data });
      if (arquivo) await api.upload(`/lancamentos/${l.id}/comprovante`, arquivo);
      onSalvo();
    });
  };

  return (
    <Modal titulo="Novo lançamento" onClose={onClose}>
      <form onSubmit={salvar}>
        <Erro msg={erro} />
        <div className="mb-3 flex gap-2">
          {(['saida', 'entrada'] as const).map((t) => (
            <button type="button" key={t} onClick={() => setTipo(t)}
              className={`flex-1 rounded-lg border py-2 text-sm font-medium ${tipo === t ? (t === 'entrada' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-red-600 bg-red-600 text-white') : 'border-slate-300'}`}>
              {t === 'entrada' ? 'Entrada' : 'Saída'}
            </button>
          ))}
        </div>
        <Campo label="Categoria">
          <select className="input" value={categoria} onChange={(e) => setCategoria(e.target.value)} required>
            {doTipo.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Campo>
        <Campo label="Descrição"><input className="input" value={descricao} onChange={(e) => setDescricao(e.target.value)} required minLength={2} /></Campo>
        <Campo label={tipo === 'entrada' ? 'Origem / pagador' : 'Favorecido'}><input className="input" value={favorecido} onChange={(e) => setFavorecido(e.target.value)} /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Valor (R$)"><input className="input" inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} required /></Campo>
          <Campo label="Data do pagamento"><input type="date" className="input" value={data} onChange={(e) => setData(e.target.value)} required /></Campo>
        </div>
        <Campo label="Conta">
          <select className="input" value={conta} onChange={(e) => setConta(e.target.value)}>
            <option value="caixa">Caixa</option>
            <option value="fundo_reserva">Fundo de reserva</option>
          </select>
        </Campo>
        <Campo label="Comprovante (foto ou PDF)">
          <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
        </Campo>
        <button className="btn w-full" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar lançamento'}</button>
      </form>
    </Modal>
  );
}
