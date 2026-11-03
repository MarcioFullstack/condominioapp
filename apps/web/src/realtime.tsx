import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { API_URL, getToken } from './api';
import { useAuth } from './auth';

type Handler = (evento: string, dados: any) => void;
const Ctx = createContext<{ assinar: (h: Handler) => () => void }>({ assinar: () => () => {} });

/** Mantém um WebSocket aberto (com reconexão) e distribui os eventos às telas. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();
  const handlers = useRef(new Set<Handler>());

  useEffect(() => {
    if (!usuario) return;
    let ws: WebSocket | null = null;
    let parar = false;
    let tentativa = 0;
    const conectar = () => {
      ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(getToken() ?? '')}`);
      ws.onopen = () => (tentativa = 0);
      ws.onmessage = (m) => {
        try {
          const { evento, dados } = JSON.parse(m.data);
          handlers.current.forEach((h) => h(evento, dados));
        } catch {
          /* ignora */
        }
      };
      ws.onclose = (e) => {
        if (parar || e.code === 4401) return;
        setTimeout(conectar, Math.min(30_000, 1000 * 2 ** tentativa++));
      };
    };
    conectar();
    return () => {
      parar = true;
      ws?.close();
    };
  }, [usuario?.id]);

  const assinar = (h: Handler) => {
    handlers.current.add(h);
    return () => handlers.current.delete(h);
  };
  return <Ctx.Provider value={{ assinar }}>{children}</Ctx.Provider>;
}

/** Chama `fn` quando chegar um dos eventos (ou qualquer um, se `eventos` for omitido). */
export function useEvento(eventos: string[] | null, fn: Handler) {
  const { assinar } = useContext(Ctx);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(
    () => assinar((e, d) => (!eventos || eventos.includes(e)) && ref.current(e, d)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assinar],
  );
}
