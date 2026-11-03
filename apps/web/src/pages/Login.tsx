import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { Campo, Erro, useAcao } from '../ui';

export default function Login() {
  const { usuario, entrar } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [totp, setTotp] = useState('');
  const [precisaTotp, setPrecisaTotp] = useState(false);
  const { ocupado, erro, rodar } = useAcao();

  if (usuario) return <Navigate to="/" replace />;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    await rodar(async () => {
      try {
        await entrar(email, senha, totp);
        nav('/');
      } catch (err) {
        if (err instanceof ApiError && err.extra?.precisaTotp) setPrecisaTotp(true);
        throw err;
      }
    });
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-2xl text-white">🏠</div>
        <h1 className="text-xl font-semibold">Gestão de Condomínio</h1>
      </div>
      <form onSubmit={enviar} className="card">
        <Erro msg={erro} />
        <Campo label="E-mail">
          <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Campo>
        <Campo label="Senha">
          <input className="input" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </Campo>
        {precisaTotp && (
          <Campo label="Código de 6 dígitos (verificação em duas etapas)">
            <input className="input" inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value)} autoFocus />
          </Campo>
        )}
        <button className="btn w-full" disabled={ocupado}>
          {ocupado ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
