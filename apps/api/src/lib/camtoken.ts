import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

// Token curto e assinado (HMAC) que autoriza UMA câmera por poucos minutos.
// O gateway valida via GET /cameras/gateway/auth; o app nunca vê o RTSP nem a senha.
const chave = createHmac('sha256', config.JWT_SECRET).update('camera-token').digest();

interface Payload {
  stream: string;
  uid: string;
  cid: string;
  exp: number; // epoch segundos
}

const assina = (b64: string) => createHmac('sha256', chave).update(b64).digest('base64url');

export function emitirTokenCamera(p: Omit<Payload, 'exp'>): { token: string; exp: number } {
  const exp = Math.floor(Date.now() / 1000) + config.CAMERA_TOKEN_TTL_SECONDS;
  const b64 = Buffer.from(JSON.stringify({ ...p, exp })).toString('base64url');
  return { token: `${b64}.${assina(b64)}`, exp };
}

export function validarTokenCamera(token: string): Payload | null {
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const esperado = assina(b64);
  if (sig.length !== esperado.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  try {
    const p = JSON.parse(Buffer.from(b64, 'base64url').toString()) as Payload;
    return p.exp > Math.floor(Date.now() / 1000) ? p : null;
  } catch {
    return null;
  }
}
