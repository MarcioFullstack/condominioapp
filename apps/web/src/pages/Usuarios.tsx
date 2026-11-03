import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { brl, paraCentavos } from '../format';
import { Campo, Erro, Modal, Selo, Titulo, useAcao } from '../ui';

const PAPEIS = ['morador', 'sindico', 'subsindico', 'tesoureiro', 'conselho', 'zelador'];

export default function Usuarios() {
  const [aba, setAba] = useState<'unidades' | 'usuarios'>('unidades');
  const [unidades, setUnidades] = useState<any[]>([]);
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [modal, setModal] = useState<'unidade' | 'usuario' | null>(null);

  const carregar = useCallback(() => {
    api.get('/unidades').then(setUnidades);
    api.get('/usuarios').then(setUsuarios);
  }, []);
  useEffect(carregar, [carregar]);

  const editarTaxa = async (u: any) => {
    const v = prompt(`Taxa mensal da ${u.identificador} (R$):`, (u.taxa_centavos / 100).toFixed(2).replace('.', ','));
    if (v === null) return;
    const c = paraCentavos(v);
    if (!(c >= 0)) return alert('Valor inválido');
    await api.patch(`/unidades/${u.id}`, { taxa_centavos: c });
    carregar();
  };

  const editarPagador = async (u: any) => {
    const nome = prompt('Nome do responsável pelo pagamento:', u.responsavel_nome ?? '');
    if (!nome) return;
    const cpf = prompt('CPF/CNPJ (somente números) — necessário para Pix/boleto:');
    if (!cpf) return;
    try { await api.patch(`/unidades/${u.id}`, { responsavel_nome: nome, responsavel_cpf_cnpj: cpf.replace(/\D/g, '') }); carregar(); } catch (e) { alert((e as Error).message); }
  };

  const alternarCameras = async (u: any) => {
    const tem = u.permissoes_extra.includes('cameras:ver');
    if (!confirm(tem ? `Retirar acesso às câmeras de ${u.nome}?` : `Liberar acesso às câmeras para ${u.nome}? Isso é uma delegação sua e fica registrada.`)) return;
    const extra = tem ? u.permissoes_extra.filter((p: string) => p !== 'cameras:ver') : [...u.permissoes_extra, 'cameras:ver'];
    await api.patch(`/usuarios/${u.id}`, { permissoes_extra: extra });
    carregar();
  };

  return (
    <>
      <Titulo acao={<button className="btn" onClick={() => setModal(aba === 'unidades' ? 'unidade' : 'usuario')}>+ {aba === 'unidades' ? 'Unidade' : 'Pessoa'}</button>}>Cadastros</Titulo>
      <div className="mb-3 flex gap-2">
        {(['unidades', 'usuarios'] as const).map((a) => (
          <button key={a} onClick={() => setAba(a)} className={`rounded-full border px-4 py-1 text-sm ${aba === a ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white'}`}>
            {a === 'unidades' ? 'Unidades' : 'Pessoas'}
          </button>
        ))}
      </div>

      {aba === 'unidades' && (
        <div className="card divide-y divide-slate-100 !p-0">
          {unidades.map((u) => (
            <div key={u.id} className="p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">{u.identificador}{u.bloco ? ` · bloco ${u.bloco}` : ''}</p>
                <button className="text-sm text-brand underline" onClick={() => editarTaxa(u)}>{brl(u.taxa_centavos)}/mês</button>
              </div>
              <p className="text-xs text-slate-500">{u.moradores.map((m: any) => m.nome).join(', ') || 'Sem moradores vinculados'}</p>
              <button className="mt-1 text-xs text-slate-500 underline" onClick={() => editarPagador(u)}>
                {u.responsavel_nome ? `Pagador: ${u.responsavel_nome}` : 'Definir pagador (Pix/boleto)'}
              </button>
            </div>
          ))}
        </div>
      )}

      {aba === 'usuarios' && (
        <div className="card divide-y divide-slate-100 !p-0">
          {usuarios.map((u) => (
            <div key={u.id} className="p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{u.nome} {!u.ativo && <Selo cor="vermelho">inativo</Selo>}</p>
                  <p className="text-xs text-slate-500">{u.email} · {u.papel}{u.unidades.length ? ` · ${u.unidades.map((x: any) => x.identificador).join(', ')}` : ''}</p>
                </div>
                <button className="btn-ghost text-xs" onClick={async () => { await api.patch(`/usuarios/${u.id}`, { ativo: !u.ativo }); carregar(); }}>
                  {u.ativo ? 'Desativar' : 'Ativar'}
                </button>
              </div>
              {u.papel !== 'sindico' && (
                <button className="mt-1 text-xs underline" onClick={() => alternarCameras(u)}>
                  {u.permissoes_extra.includes('cameras:ver') ? '📹 Câmeras liberadas (retirar)' : '📹 Liberar câmeras'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {modal === 'unidade' && <NovaUnidade onClose={() => setModal(null)} onSalvo={() => { setModal(null); carregar(); }} />}
      {modal === 'usuario' && <NovoUsuario unidades={unidades} onClose={() => setModal(null)} onSalvo={() => { setModal(null); carregar(); }} />}
    </>
  );
}

function NovaUnidade({ onClose, onSalvo }: { onClose: () => void; onSalvo: () => void }) {
  const [identificador, setId] = useState('');
  const [bloco, setBloco] = useState('');
  const [taxa, setTaxa] = useState('');
  const { ocupado, erro, rodar, setErro } = useAcao();
  const salvar = (e: FormEvent) => {
    e.preventDefault();
    const c = taxa ? paraCentavos(taxa) : 0;
    if (!(c >= 0)) return setErro('Taxa inválida');
    rodar(async () => { await api.post('/unidades', { identificador, bloco: bloco || undefined, taxa_centavos: c }); onSalvo(); });
  };
  return (
    <Modal titulo="Nova unidade" onClose={onClose}>
      <form onSubmit={salvar}>
        <Erro msg={erro} />
        <Campo label="Identificação (ex.: Casa 12)"><input className="input" value={identificador} onChange={(e) => setId(e.target.value)} required /></Campo>
        <Campo label="Bloco (opcional)"><input className="input" value={bloco} onChange={(e) => setBloco(e.target.value)} /></Campo>
        <Campo label="Taxa mensal (R$)"><input className="input" inputMode="decimal" value={taxa} onChange={(e) => setTaxa(e.target.value)} /></Campo>
        <button className="btn w-full" disabled={ocupado}>Salvar</button>
      </form>
    </Modal>
  );
}

function NovoUsuario({ unidades, onClose, onSalvo }: { unidades: any[]; onClose: () => void; onSalvo: () => void }) {
  const [f, setF] = useState({ nome: '', email: '', telefone: '', senha: '', papel: 'morador', unidade_id: '' });
  const { ocupado, erro, rodar } = useAcao();
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }));
  const salvar = (e: FormEvent) => {
    e.preventDefault();
    rodar(async () => { await api.post('/usuarios', { ...f, telefone: f.telefone || undefined, unidade_id: f.unidade_id || undefined }); onSalvo(); });
  };
  return (
    <Modal titulo="Nova pessoa" onClose={onClose}>
      <form onSubmit={salvar}>
        <Erro msg={erro} />
        <Campo label="Nome"><input className="input" value={f.nome} onChange={(e) => set('nome', e.target.value)} required /></Campo>
        <Campo label="E-mail"><input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required /></Campo>
        <Campo label="Telefone (opcional)"><input className="input" value={f.telefone} onChange={(e) => set('telefone', e.target.value)} /></Campo>
        <Campo label="Senha inicial (mín. 8 caracteres)"><input className="input" type="password" minLength={8} value={f.senha} onChange={(e) => set('senha', e.target.value)} required /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Papel"><select className="input" value={f.papel} onChange={(e) => set('papel', e.target.value)}>{PAPEIS.map((p) => <option key={p}>{p}</option>)}</select></Campo>
          <Campo label="Unidade"><select className="input" value={f.unidade_id} onChange={(e) => set('unidade_id', e.target.value)}><option value="">—</option>{unidades.map((u) => <option key={u.id} value={u.id}>{u.identificador}</option>)}</select></Campo>
        </div>
        <button className="btn w-full" disabled={ocupado}>Cadastrar</button>
      </form>
    </Modal>
  );
}
