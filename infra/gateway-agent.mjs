// Agente do gateway: roda no mini PC do condomínio, ao lado do go2rtc.
// Lê os streams do go2rtc e informa à API quais câmeras estão online/offline.
//   API_URL=https://api.seu-dominio CONDOMINIO_ID=<uuid> GATEWAY_TOKEN=<token> node infra/gateway-agent.mjs
const API = process.env.API_URL ?? 'http://localhost:3333';
const GO2RTC = process.env.GO2RTC_URL ?? 'http://127.0.0.1:1984';
const CID = process.env.CONDOMINIO_ID;
const TOKEN = process.env.GATEWAY_TOKEN;
if (!CID || !TOKEN) throw new Error('Defina CONDOMINIO_ID e GATEWAY_TOKEN');

async function ciclo() {
  try {
    const streams = await (await fetch(`${GO2RTC}/api/streams`)).json();
    const lista = Object.entries(streams).map(([nome, s]) => ({
      nome,
      // stream com produtor conectado = câmera respondendo
      online: Array.isArray(s?.producers) && s.producers.some((p) => p.state !== 'error' && (p.url || p.medias)),
    }));
    const r = await fetch(`${API}/cameras/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gateway-token': TOKEN },
      body: JSON.stringify({ condominio_id: CID, streams: lista }),
    });
    if (!r.ok) console.error('heartbeat recusado', r.status);
  } catch (e) {
    console.error('falha no ciclo:', e.message);
  }
}

await ciclo();
setInterval(ciclo, 30_000);
