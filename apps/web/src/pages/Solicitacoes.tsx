import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { abrirArquivo, api } from '../api';
import { useAuth } from '../auth';
import { dataHoraBR, STATUS_SOLICITACAO, TIPO_SOLICITACAO } from '../format';
import { useEvento } from '../realtime';
import { Campo, Erro, Modal, Selo, Titulo, Vazio, useAcao } from '../ui';

const COR: Record<string, 'azul' | 'amarelo' | 'verde' | 'vermelho'> = {
  aberta: 'azul', em_analise: 'amarelo', em_execucao: 'amarelo', concluida: 'verde', recusada: 'vermelho',
};

export default function Solicitacoes() {
  const { pode } = useAuth();
  const [lista, setLista] = useState<any[]>([]);
  const [novo, setNovo] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);

  const carregar = useCallback(() => { api.get('/solicitacoes').then(setLista); }, []);
  useEffect(carregar, [carregar]);
  useEvento(['solicitacao.nova', 'solicitacao.atualizada'], carregar);

  return (
    <>
      <Titulo acao={<button className="btn" onClick={() => setNovo(true)}>+ Novo pedido</button>}>
        {pode('solicitacao:ver_todas') ? 'Pedidos dos moradores' : 'Meus pedidos'}
      </Titulo>
      {lista.length === 0 && <Vazio>Nenhum pedido por enquanto.</Vazio>}
      <div className="space-y-2">
        {lista.map((s) => (
          <button key={s.id} onClick={() => setAberta(s.id)} className="card block w-full text-left">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">{s.titulo}</p>
              <Selo cor={COR[s.status]}>{STATUS_SOLICITACAO[s.status]}</Selo>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {TIPO_SOLICITACAO[s.tipo]} · prioridade {s.prioridade} · {s.solicitante}
              {s.unidade ? ` (${s.unidade})` : ''} · {dataHoraBR(s.updated_at)} · 💬 {s.comentarios}
            </p>
          </button>
        ))}
      </div>
      {novo && <Novo onClose={() => setNovo(false)} onSalvo={() => { setNovo(false); carregar(); }} />}
      {aberta && <Detalhe id={aberta} onClose={() => setAberta(null)} onMudou={carregar} />}
    </>
  );
}

function Novo({ onClose, onSalvo }: { onClose: () => void; onSalvo: () => void }) {
  const { usuario } = useAuth();
  const [f, setF] = useState({ tipo: 'manutencao', prioridade: 'media', titulo: '', descricao: '', local: '', unidade_id: usuario?.unidades[0]?.id ?? '' });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const { ocupado, erro, rodar } = useAcao();
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }));

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    rodar(async () => {
      const s = await api.post('/solicitacoes', { ...f, local: f.local || undefined, unidade_id: f.unidade_id || undefined });
      if (arquivo) await api.upload(`/solicitacoes/${s.id}/anexos`, arquivo);
      onSalvo();
    });
  };

  return (
    <Modal titulo="Novo pedido" onClose={onClose}>
      <form onSubmit={enviar}>
        <Erro msg={erro} />
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Tipo">
            <select className="input" value={f.tipo} onChange={(e) => set('tipo', e.target.value)}>
              {Object.entries(TIPO_SOLICITACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Campo>
          <Campo label="Prioridade">
            <select className="input" value={f.prioridade} onChange={(e) => set('prioridade', e.target.value)}>
              <option value="baixa">Baixa</option><option value="media">Média</option><option value="alta">Alta</option>
            </select>
          </Campo>
        </div>
        <Campo label="Título"><input className="input" value={f.titulo} onChange={(e) => set('titulo', e.target.value)} required minLength={3} /></Campo>
        <Campo label="Descrição"><textarea className="input" rows={4} value={f.descricao} onChange={(e) => set('descricao', e.target.value)} required minLength={3} /></Campo>
        <Campo label="Local no condomínio (opcional)"><input className="input" value={f.local} onChange={(e) => set('local', e.target.value)} /></Campo>
        <Campo label="Foto (opcional)"><input type="file" accept="image/*,application/pdf" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} /></Campo>
        <button className="btn w-full" disabled={ocupado}>{ocupado ? 'Enviando…' : 'Enviar pedido'}</button>
      </form>
    </Modal>
  );
}

function Detalhe({ id, onClose, onMudou }: { id: string; onClose: () => void; onMudou: () => void }) {
  const { pode } = useAuth();
  const [s, setS] = useState<any>(null);
  const [texto, setTexto] = useState('');
  const { erro, rodar } = useAcao();
  const carregar = useCallback(() => { api.get(`/solicitacoes/${id}`).then(setS); }, [id]);
  useEffect(carregar, [carregar]);
  useEvento(['solicitacao.atualizada'], (_e, d) => d.id === id && carregar());

  if (!s) return null;
  const comentar = (e: FormEvent) => {
    e.preventDefault();
    rodar(async () => { await api.post(`/solicitacoes/${id}/comentarios`, { texto }); setTexto(''); carregar(); onMudou(); });
  };
  const mudar = (status: string) => rodar(async () => { await api.patch(`/solicitacoes/${id}`, { status }); carregar(); onMudou(); });

  return (
    <Modal titulo={s.titulo} onClose={onClose}>
      <Erro msg={erro} />
      <p className="mb-1"><Selo cor={COR[s.status]}>{STATUS_SOLICITACAO[s.status]}</Selo> <span className="text-xs text-slate-500">{TIPO_SOLICITACAO[s.tipo]} · {s.prioridade}{s.local ? ` · ${s.local}` : ''}</span></p>
      <p className="mb-3 whitespace-pre-wrap text-sm">{s.descricao}</p>
      {s.anexos.map((a: string) => <button key={a} className="btn-ghost mb-2 mr-2 text-xs" onClick={() => abrirArquivo(`/arquivos/${a}`)}>📎 Anexo</button>)}

      {pode('solicitacao:gerir') && (
        <div className="mb-3 flex flex-wrap gap-2">
          {Object.entries(STATUS_SOLICITACAO).filter(([k]) => k !== s.status).map(([k, v]) => (
            <button key={k} className="btn-ghost text-xs" onClick={() => mudar(k)}>→ {v}</button>
          ))}
        </div>
      )}

      <h3 className="mb-1 text-sm font-semibold">Histórico</h3>
      {s.comentarios.length === 0 && <p className="text-sm text-slate-500">Sem comentários.</p>}
      {s.comentarios.map((c: any) => (
        <div key={c.id} className="mb-2 rounded-lg bg-slate-50 p-2 text-sm">
          <p className="text-xs text-slate-500">{c.autor} · {dataHoraBR(c.created_at)}</p>
          {c.texto}
        </div>
      ))}
      <form onSubmit={comentar} className="mt-2 flex gap-2">
        <input className="input" placeholder="Escreva um comentário" value={texto} onChange={(e) => setTexto(e.target.value)} required />
        <button className="btn">Enviar</button>
      </form>
    </Modal>
  );
}
