import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { abrirArquivo, api } from '../api';
import { useAuth } from '../auth';
import { dataHoraBR } from '../format';
import { useEvento } from '../realtime';
import { Modal, Titulo, useAcao } from '../ui';

export default function Chat() {
  const { usuario, pode } = useAuth();
  const [canais, setCanais] = useState<any[]>([]);
  const [canal, setCanal] = useState<any>(null);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [texto, setTexto] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [pessoas, setPessoas] = useState<any[] | null>(null);
  const fim = useRef<HTMLDivElement>(null);
  const { erro, rodar } = useAcao();

  const carregarCanais = useCallback(async () => {
    const c = await api.get('/chat/canais');
    setCanais(c);
    setCanal((atual: any) => atual ?? c.find((x: any) => x.slug === 'geral') ?? c[0] ?? null);
  }, []);
  useEffect(() => { carregarCanais(); }, [carregarCanais]);

  const abrir = useCallback(async (c: any) => {
    setMsgs(await api.get(`/chat/canais/${c.id}/mensagens`));
    api.post(`/chat/canais/${c.id}/lido`).then(carregarCanais).catch(() => {});
  }, [carregarCanais]);
  useEffect(() => { if (canal) abrir(canal); }, [canal?.id]); // eslint-disable-line
  useEffect(() => { fim.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length]);

  // Mensagens chegam por WebSocket; as do canal aberto entram na tela, as demais viram contador.
  useEvento(['mensagem.nova', 'mensagem.removida'], (e, d) => {
    if (e === 'mensagem.removida') return setMsgs((m) => m.filter((x) => x.id !== d.id));
    if (canal && d.canal_id === canal.id) {
      setMsgs((m) => (m.some((x) => x.id === d.id) ? m : [...m, d]));
      api.post(`/chat/canais/${canal.id}/lido`).catch(() => {});
    } else carregarCanais();
  });

  const podeEscrever = canal && (!canal.somente_sindico_escreve || pode('chat:avisos'));

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!texto.trim() && !arquivo) return;
    rodar(async () => {
      let anexo: string | undefined;
      if (arquivo) anexo = (await api.upload('/chat/upload', arquivo)).arquivo;
      await api.post(`/chat/canais/${canal.id}/mensagens`, { texto: texto.trim() || '📎 Anexo', anexo });
      setTexto('');
      setArquivo(null);
    });
  };

  const novaConversa = async () => setPessoas(await api.get('/chat/pessoas'));
  const iniciarDm = async (id: string) => {
    const dm = await api.post('/chat/dm', { usuario_id: id });
    setPessoas(null);
    await carregarCanais();
    const c = (await api.get('/chat/canais')).find((x: any) => x.id === dm.id);
    setCanal(c);
  };

  return (
    <>
      <Titulo acao={<button className="btn-ghost" onClick={novaConversa}>+ Conversa direta</button>}>Chat</Titulo>
      <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
        {canais.map((c) => (
          <button key={c.id} onClick={() => setCanal(c)}
            className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm ${canal?.id === c.id ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white'}`}>
            {c.tipo === 'dm' ? '👤 ' : c.tipo === 'avisos' ? '📢 ' : '# '}{c.titulo}
            {c.nao_lidas > 0 && canal?.id !== c.id && <span className="ml-1 rounded-full bg-red-500 px-1.5 text-xs text-white">{c.nao_lidas}</span>}
          </button>
        ))}
      </div>

      <div className="card flex h-[60vh] flex-col !p-0">
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {msgs.length === 0 && <p className="text-center text-sm text-slate-400">Nenhuma mensagem ainda.</p>}
          {msgs.map((m) => {
            const minha = m.usuario_id === usuario?.id;
            return (
              <div key={m.id} className={`flex ${minha ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${minha ? 'bg-brand text-white' : 'bg-slate-100'}`}>
                  {!minha && <p className="text-xs font-semibold">{m.autor}{m.papel !== 'morador' ? ` · ${m.papel}` : ''}</p>}
                  <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                  {m.anexo && <button className="mt-1 text-xs underline" onClick={() => abrirArquivo(`/arquivos/${m.anexo}`)}>abrir anexo</button>}
                  <p className={`mt-0.5 text-[10px] ${minha ? 'text-blue-100' : 'text-slate-400'}`}>
                    {dataHoraBR(m.created_at)}
                    {canal?.tipo === 'avisos' && pode('chat:avisos') ? ` · lido por ${m.leituras}` : ''}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={fim} />
        </div>
        {erro && <p className="px-3 text-xs text-red-600">{erro}</p>}
        {podeEscrever ? (
          <form onSubmit={enviar} className="flex items-center gap-2 border-t border-slate-200 p-2">
            <label className="cursor-pointer px-1 text-xl" title="Anexar">
              📎<input type="file" className="hidden" accept="image/*,application/pdf" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            </label>
            <input className="input" placeholder={arquivo ? `Anexo: ${arquivo.name}` : 'Escreva uma mensagem'} value={texto} onChange={(e) => setTexto(e.target.value)} />
            <button className="btn">Enviar</button>
          </form>
        ) : (
          <p className="border-t border-slate-200 p-3 text-center text-xs text-slate-500">Somente a administração escreve neste canal.</p>
        )}
      </div>

      {pessoas && (
        <Modal titulo="Conversar com…" onClose={() => setPessoas(null)}>
          {pessoas.map((p) => (
            <button key={p.id} className="block w-full border-b border-slate-100 py-2 text-left text-sm hover:bg-slate-50" onClick={() => iniciarDm(p.id)}>{p.nome}</button>
          ))}
        </Modal>
      )}
    </>
  );
}
