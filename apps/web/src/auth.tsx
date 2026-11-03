import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  papel: string;
  perms: string[];
  totp_ativo: boolean;
  unidades: { id: string; identificador: string }[];
}

interface Ctx {
  usuario: Usuario | null;
  carregando: boolean;
  pode: (...p: string[]) => boolean;
  entrar: (email: string, senha: string, totp?: string) => Promise<{ aviso?: string | null }>;
  sair: () => void;
  recarregar: () => Promise<void>;
}

const AuthCtx = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(!!getToken());

  const recarregar = useCallback(async () => {
    if (!getToken()) return setCarregando(false);
    try {
      setUsuario(await api.get<Usuario>('/auth/me'));
    } catch {
      setToken(null);
      setUsuario(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    recarregar();
  }, [recarregar]);

  const entrar: Ctx['entrar'] = async (email, senha, totp) => {
    const r = await api.post<{ token: string; avisoTotp: string | null }>('/auth/login', { email, senha, totp: totp || undefined });
    setToken(r.token);
    await recarregar();
    return { aviso: r.avisoTotp };
  };

  const sair = () => {
    setToken(null);
    setUsuario(null);
  };

  const pode = (...p: string[]) => !!usuario && p.some((x) => usuario.perms.includes(x));

  return <AuthCtx.Provider value={{ usuario, carregando, pode, entrar, sair, recarregar }}>{children}</AuthCtx.Provider>;
}
