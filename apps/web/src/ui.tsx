import { useState, type ReactNode } from 'react';

export function Titulo({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h1 className="text-lg font-semibold text-slate-900">{children}</h1>
      {acao}
    </div>
  );
}

export function Modal({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{titulo}</h2>
          <button className="text-2xl leading-none text-slate-400" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Erro({ msg }: { msg: string }) {
  return msg ? <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</p> : null;
}

export function Vazio({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</p>;
}

const CORES: Record<string, string> = {
  verde: 'bg-emerald-100 text-emerald-800',
  vermelho: 'bg-red-100 text-red-800',
  amarelo: 'bg-amber-100 text-amber-800',
  azul: 'bg-blue-100 text-blue-800',
  cinza: 'bg-slate-100 text-slate-700',
};
export function Selo({ cor = 'cinza', children }: { cor?: keyof typeof CORES; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CORES[cor]}`}>{children}</span>;
}

/** Executa uma ação assíncrona controlando "carregando" e erro. */
export function useAcao() {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const rodar = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    setErro('');
    try {
      await fn();
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    } finally {
      setOcupado(false);
    }
  };
  return { ocupado, erro, rodar, setErro };
}
