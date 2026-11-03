export const API_URL: string = (import.meta.env.VITE_API_URL ?? 'http://localhost:3333').replace(/\/$/, '');

const KEY = 'condominio.token';
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

export class ApiError extends Error {
  constructor(public status: number, message: string, public extra?: any) {
    super(message);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const r = await fetch(API_URL + path, {
    method,
    headers: {
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 401 && getToken() && !path.startsWith('/auth/login')) {
      setToken(null);
      location.href = '/login';
    }
    throw new ApiError(r.status, data?.erro ?? `Erro ${r.status}`, data);
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => req<T>('GET', p),
  post: <T = any>(p: string, b?: unknown) => req<T>('POST', p, b ?? {}),
  patch: <T = any>(p: string, b: unknown) => req<T>('PATCH', p, b),
  del: <T = any>(p: string) => req<T>('DELETE', p),
  upload: <T = any>(p: string, file: File) => {
    const f = new FormData();
    f.append('file', file);
    return req<T>('POST', p, f);
  },
};

/** Abre um arquivo protegido (comprovante, anexo) usando o token. */
export async function abrirArquivo(path: string) {
  const r = await fetch(API_URL + path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!r.ok) throw new Error('Arquivo indisponível');
  const url = URL.createObjectURL(await r.blob());
  window.open(url, '_blank');
}

export async function blobUrl(path: string): Promise<string> {
  const r = await fetch(API_URL + path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!r.ok) throw new Error('Arquivo indisponível');
  return URL.createObjectURL(await r.blob());
}
