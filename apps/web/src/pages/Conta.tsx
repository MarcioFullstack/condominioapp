import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Campo, Erro, Titulo, useAcao } from '../ui';

export default function Conta() {
  const { usuario, sair, recarregar } = useAuth();
  const nav = useNavigate();
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [msg, setMsg] = useState('');
  const dois = useAcao();
  const senha = useAcao();
  const [s, setS] = useState({ atual: '', nova: '' });

  const ativar = (e: FormEvent) => {
    e.preventDefault();
    dois.rodar(async () => { await api.post('/auth/2fa/ativar', { codigo }); setSetup(null); setCodigo(''); setMsg('Verificação em duas etapas ativada.'); await recarregar(); });
  };

  const trocarSenha = (e: FormEvent) => {
    e.preventDefault();
    senha.rodar(async () => { await api.post('/auth/senha', s); setS({ atual: '', nova: '' }); setMsg('Senha alterada.'); });
  };

  if (!usuario) return null;
  return (
    <>
      <Titulo>Minha conta</Titulo>
      <div className="card mb-3">
        <p className="font-medium">{usuario.nome}</p>
        <p className="text-sm text-slate-500">{usuario.email} · {usuario.papel}</p>
        {usuario.unidades.length > 0 && <p className="text-sm text-slate-500">Unidade: {usuario.unidades.map((u) => u.identificador).join(', ')}</p>}
      </div>
      {msg && <p className="mb-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">{msg}</p>}

      <section className="card mb-3">
        <h2 className="mb-1 text-sm font-semibold">Verificação em duas etapas</h2>
        {usuario.totp_ativo ? (
          <p className="text-sm text-emerald-700">Ativada ✔</p>
        ) : (
          <>
            <p className="mb-2 text-sm text-slate-600">
              {usuario.papel === 'sindico' ? 'Obrigatória para o síndico (acesso às câmeras). ' : ''}Use um app autenticador (Google Authenticator, Authy…).
            </p>
            {!setup ? (
              <button className="btn" onClick={() => dois.rodar(async () => setSetup(await api.post('/auth/2fa/setup')))}>Configurar</button>
            ) : (
              <form onSubmit={ativar}>
                <p className="mb-1 text-sm">Adicione esta chave no app autenticador:</p>
                <code className="mb-2 block break-all rounded bg-slate-100 p-2 text-sm">{setup.secret}</code>
                <a className="mb-2 block text-xs text-brand underline" href={setup.otpauth}>Abrir no app autenticador</a>
                <Campo label="Código de 6 dígitos"><input className="input" inputMode="numeric" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value)} required /></Campo>
                <button className="btn">Ativar</button>
              </form>
            )}
            <Erro msg={dois.erro} />
          </>
        )}
      </section>

      <form onSubmit={trocarSenha} className="card mb-3">
        <h2 className="mb-2 text-sm font-semibold">Alterar senha</h2>
        <Erro msg={senha.erro} />
        <Campo label="Senha atual"><input className="input" type="password" value={s.atual} onChange={(e) => setS({ ...s, atual: e.target.value })} required /></Campo>
        <Campo label="Nova senha (mín. 8)"><input className="input" type="password" minLength={8} value={s.nova} onChange={(e) => setS({ ...s, nova: e.target.value })} required /></Campo>
        <button className="btn">Alterar</button>
      </form>

      <button className="btn-ghost w-full" onClick={() => { sair(); nav('/login'); }}>Sair</button>
    </>
  );
}
