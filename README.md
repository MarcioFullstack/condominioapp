# Gestão de Condomínio

App multi-condomínio (SaaS) para síndico, moradores e zelador: financeiro em livro-caixa, cobrança e inadimplência, painel em tempo real, chat embutido, solicitações e câmeras exclusivas do síndico.

**Stack:** Node.js 20+ / TypeScript / Fastify / PostgreSQL 16 · React 18 / Vite / Tailwind (PWA) · WebSocket · go2rtc (vídeo).

## Rodar em desenvolvimento

```bash
npm install                       # instala api + web (workspaces)
npm run db:up                     # Postgres via Docker (ou use um Postgres seu)
cp apps/api/.env.example apps/api/.env
#   edite JWT_SECRET e CAMERA_KEY:  openssl rand -hex 32
cp apps/web/.env.example apps/web/.env
npm run db:migrate                # cria as tabelas
npm run db:seed                   # condomínio de exemplo + plano de contas da planilha
npm run dev:api                   # http://localhost:3333
npm run dev:web                   # http://localhost:5173
```

Logins do seed (senha `Trocar@123`, troque antes de usar de verdade):
`sindico@exemplo.com` · `tesoureiro@exemplo.com` · `zelador@exemplo.com` · `morador@exemplo.com`

## Módulos (MVP)

| Módulo | Onde | Resumo |
| --- | --- | --- |
| Financeiro | `routes/financeiro.ts` | Livro-caixa **imutável** (trigger no banco bloqueia UPDATE/DELETE); correção só por **estorno**. Valores em centavos. Caixa separado do fundo de reserva. Comprovante por upload. Relatório mensal. |
| Cobrança / inadimplência | `routes/cobrancas.ts` | Gera a taxa do mês por unidade (idempotente), multa 2% + juros 1% a.m. pro rata, baixa automática por webhook (Asaas) ou manual, painel de inadimplentes só para quem tem permissão. |
| Painel em tempo real | `routes/dashboard.ts` + `lib/realtime.ts` | Cada lançamento/pagamento/pedido dispara evento WebSocket e o painel recarrega. |
| Chat | `routes/chat.ts` | Canais Geral, Avisos (só administração escreve, com confirmação de leitura), Financeiro, Manutenção e DMs privadas. Anexos. |
| Solicitações | `routes/solicitacoes.ts` | Aberta → Em análise → Em execução → Concluída/Recusada, comentários, anexos, avisa o morador a cada mudança; manutenção pode virar despesa no caixa. |
| Câmeras (síndico) | `routes/cameras.ts` | Permissão `cameras:ver` só do síndico (delegável). RTSP guardado **cifrado** (AES-256-GCM) e nunca sai da API. Token curto HMAC por sessão, log de cada acesso. |
| Cadastros / auditoria | `routes/cadastros.ts` | Unidades, pessoas, vínculos, delegação de permissões, trilha de auditoria. |

Permissões por papel em `apps/api/src/lib/permissions.ts`. Morador nunca vê dados de outra unidade.

## Cobrança por Pix/boleto (Asaas)

1. Crie conta no Asaas e use a **sandbox** primeiro. Preencha `ASAAS_API_KEY` e `ASAAS_BASE_URL` no `.env`.
2. No app: **Cadastros → Unidades → Definir pagador** (nome + CPF/CNPJ de cada unidade; o PSP exige).
3. No painel do Asaas, aponte o webhook para `https://SUA_API/webhooks/psp` com o mesmo valor de `PSP_WEBHOOK_TOKEN` (eventos `PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED`).
4. Sem chave, tudo funciona em **modo manual** (tesoureiro dá baixa).

## Câmeras ao vivo

1. No **mini PC do condomínio** (mesma rede das câmeras): `docker compose --profile video up -d go2rtc` e cadastre os streams RTSP em `infra/go2rtc.yaml`.
2. Publique o go2rtc **atrás de um proxy** que valide o token (`infra/nginx-camera.conf`). Nunca exponha a porta 1984 na internet. O ideal é servir o vídeo no mesmo domínio da API/app (evita problemas de cookie/CORS no HLS).
3. Cadastre a câmera no app (nome do stream = nome no `go2rtc.yaml`).
4. Status online/offline: `infra/gateway-agent.mjs` (veja o cabeçalho do arquivo).
5. LGPD: placa de aviso de monitoramento, finalidade (segurança), prazo de guarda, e nenhuma câmera filmando interior de unidade.

> Atenção: o fluxo HLS com token por cookie precisa ser testado com **suas** câmeras e seu proxy; é a parte que mais depende do ambiente.

## Produção (checklist)

- [ ] `JWT_SECRET` e `CAMERA_KEY` fortes e fora do repositório; HTTPS na frente da API e do app.
- [ ] Trocar as senhas do seed; síndico ativa 2FA em **Conta**.
- [ ] Backup diário do Postgres e da pasta `UPLOAD_DIR`.
- [ ] `npm run build` e servir `apps/web/dist` (SPA, fallback para `index.html`) + `node apps/api/dist/server.js`.
- [ ] Rate limit/WAF no login (hoje não há limitação de tentativas).

## Fora do MVP (fase 2+)

Consumo de água/energia, régua de cobrança por WhatsApp, acordos/parcelamento, reservas do deck, PDF automático da prestação de contas (hoje: imprimir da tela), orçamento previsto × realizado, gravação de câmeras, assembleias, app nativo.
