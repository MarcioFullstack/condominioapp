import Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { dataHoraBR } from '../format';
import { useEvento } from '../realtime';
import { Campo, Erro, Modal, Selo, Titulo, Vazio, useAcao } from '../ui';

// Exclusivo do síndico (permissão cameras:ver). O app nunca recebe RTSP nem senha da câmera:
// só uma URL do gateway com token de poucos minutos, e cada abertura vira log de auditoria.
export default function Cameras() {
  const [lista, setLista] = useState<any[]>([]);
  const [log, setLog] = useState<any[]>([]);
  const [ver, setVer] = useState<any>(null);
  const [novo, setNovo] = useState(false);

  const carregar = useCallback(() => {
    api.get('/cameras').then(setLista);
    api.get('/cameras/log').then(setLog);
  }, []);
  useEffect(carregar, [carregar]);
  useEvento(['camera.status'], carregar);

  return (
    <>
      <Titulo acao={<button className="btn" onClick={() => setNovo(true)}>+ Câmera</button>}>Câmeras</Titulo>
      <p className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
        Acesso restrito ao síndico. Todas as visualizações são registradas (quem, qual câmera e quando).
      </p>
      {lista.length === 0 && <Vazio>Nenhuma câmera cadastrada.</Vazio>}
      <div className="grid gap-3 sm:grid-cols-2">
        {lista.map((c) => (
          <div key={c.id} className="card">
            <div className="flex items-center justify-between">
              <p className="font-medium">{c.nome}</p>
              <Selo cor={c.online ? 'verde' : 'vermelho'}>{c.online ? 'online' : 'offline'}</Selo>
            </div>
            <p className="text-xs text-slate-500">{c.tipo === 'externa' ? 'Externa' : 'Interna'}{c.local ? ` · ${c.local}` : ''}</p>
            <button className="btn mt-3 w-full" onClick={() => setVer(c)}>Ver ao vivo</button>
          </div>
        ))}
      </div>

      <h2 className="mb-1 mt-5 text-sm font-semibold">Últimos acessos</h2>
      <div className="card divide-y divide-slate-100 !p-0">
        {log.slice(0, 15).map((l) => (
          <p key={l.id} className="p-2 text-xs text-slate-600">{dataHoraBR(l.inicio)} · {l.usuario} abriu <b>{l.camera}</b></p>
        ))}
        {log.length === 0 && <p className="p-2 text-xs text-slate-400">Sem acessos.</p>}
      </div>

      {ver && <Player camera={ver} onClose={() => { setVer(null); api.get('/cameras/log').then(setLog); }} />}
      {novo && <NovaCamera onClose={() => setNovo(false)} onSalvo={() => { setNovo(false); carregar(); }} />}
    </>
  );
}

function Player({ camera, onClose }: { camera: any; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let hls: Hls | null = null;
    let timer: number | undefined;
    const iniciar = async () => {
      try {
        const s = await api.post(`/cameras/${camera.id}/sessao`);
        const el = video.current!;
        if (Hls.isSupported()) {
          hls = new Hls({ xhrSetup: (xhr) => { xhr.withCredentials = true; }, liveSyncDurationCount: 2 });
          hls.loadSource(s.hls);
          hls.attachMedia(el);
          hls.on(Hls.Events.ERROR, (_e, d) => d.fatal && setErro('Não foi possível abrir o vídeo. Verifique o gateway e a câmera.'));
        } else {
          el.src = s.hls; // Safari/iOS: HLS nativo
        }
        // O token vale poucos minutos: renova a sessão antes de expirar (gera novo log).
        timer = window.setTimeout(() => { hls?.destroy(); iniciar(); }, Math.max(30, s.expira_em - Math.floor(Date.now() / 1000) - 15) * 1000);
      } catch (e) {
        setErro((e as Error).message);
      }
    };
    iniciar();
    return () => { hls?.destroy(); window.clearTimeout(timer); };
  }, [camera.id]);

  return (
    <Modal titulo={camera.nome} onClose={onClose}>
      <Erro msg={erro} />
      <video ref={video} className="aspect-video w-full rounded-lg bg-black" autoPlay muted playsInline controls />
    </Modal>
  );
}

function NovaCamera({ onClose, onSalvo }: { onClose: () => void; onSalvo: () => void }) {
  const [f, setF] = useState({ nome: '', tipo: 'externa', local: '', stream_name: '', rtsp_url: '' });
  const { ocupado, erro, rodar } = useAcao();
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }));
  const salvar = (e: FormEvent) => {
    e.preventDefault();
    rodar(async () => { await api.post('/cameras', { ...f, local: f.local || undefined, rtsp_url: f.rtsp_url || undefined }); onSalvo(); });
  };
  return (
    <Modal titulo="Nova câmera" onClose={onClose}>
      <form onSubmit={salvar}>
        <Erro msg={erro} />
        <Campo label="Nome"><input className="input" value={f.nome} onChange={(e) => set('nome', e.target.value)} required /></Campo>
        <Campo label="Tipo">
          <select className="input" value={f.tipo} onChange={(e) => set('tipo', e.target.value)}><option value="externa">Externa</option><option value="interna">Interna</option></select>
        </Campo>
        <Campo label="Local"><input className="input" value={f.local} onChange={(e) => set('local', e.target.value)} /></Campo>
        <Campo label="Nome do stream no gateway (ex.: portao_frente)"><input className="input" value={f.stream_name} onChange={(e) => set('stream_name', e.target.value)} pattern="[a-zA-Z0-9_-]+" required /></Campo>
        <Campo label="URL RTSP (guardada cifrada, nunca exibida)"><input className="input" placeholder="rtsp://usuario:senha@ip:554/..." value={f.rtsp_url} onChange={(e) => set('rtsp_url', e.target.value)} /></Campo>
        <button className="btn w-full" disabled={ocupado}>Salvar</button>
      </form>
    </Modal>
  );
}
