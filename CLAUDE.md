# CLAUDE.md — Gestão de Condomínio

Monorepo npm workspaces: `apps/api` (Fastify + TypeScript + PostgreSQL) e `apps/web` (React + Vite + Tailwind, PWA).

## Comandos
- `npm run typecheck` — API e web. Rode antes de dar uma tarefa por concluída.
- `npm run db:migrate` / `npm run db:seed` — migrações em `apps/api/migrations/*.sql` (ordem alfabética, aplicadas uma vez).
- `npm run dev:api` (3333) · `npm run dev:web` (5173).

## Regras que NÃO podem ser quebradas
1. **Dinheiro em centavos inteiros** (`bigint` no banco, `number` no JS). Nunca float. Conversão de texto só em `apps/web/src/format.ts`.
2. **Livro-caixa imutável.** Tabela `lancamento` tem trigger bloqueando UPDATE/DELETE. Correção = `POST /lancamentos/:id/estorno`. Não crie rotas de edição/exclusão de lançamento.
3. **Multi-tenant:** toda query filtra por `condominio_id = req.user.cid`. Nunca confie em `condominio_id` vindo do cliente.
4. **Permissões** (`apps/api/src/lib/permissions.ts`): proteja rotas com `app.exige('perm')`. `cameras:ver` é só do síndico (ou delegado em `permissoes_extra`). Morador nunca vê inadimplência nem dados de outra unidade.
5. **Câmeras:** o RTSP fica cifrado no banco e nunca é retornado por nenhuma rota. O app só recebe URL do gateway com token curto. Todo acesso gera `camera_acesso_log` + `auditoria`.
6. **Auditoria:** ações financeiras e sensíveis chamam `audita(req, ...)`.
7. **Tempo real:** mudou algo que afeta o painel → `atualizarPainel(cid)`; eventos sensíveis usam `publicar(..., { perm | usuarios })`. Nunca publique dados financeiros sem filtro de permissão.
8. **Webhook do PSP é idempotente** (`baixarCobranca` retorna `null` se já paga). Mantenha assim.
9. Arquivos enviados são servidos só por rotas autenticadas (`/comprovantes/:id`, `/arquivos/*`), nunca como estático.

## Convenções
- API em `src/routes/<modulo>.ts`, uma função `xxxRoutes(app)` registrada em `server.ts`. Validação de entrada com zod.
- Mensagens de erro ao usuário em português. Resposta de erro: `{ erro: string }`.
- Front: uma página por rota em `src/pages`, dados via `api` (`src/api.ts`), eventos via `useEvento`.
- Novas tabelas/colunas: nova migração `002_*.sql`; nunca edite uma migração já aplicada.

## Estado atual
- MVP implementado e testado na API (cobrança com multa/juros, webhook, estorno, imutabilidade, permissões, chat privado, WebSocket).
- **Não testado:** interface no navegador e vídeo ao vivo com câmeras reais (depende do gateway/proxy).
- Ideias para a próxima fase em `README.md` (seção "Fora do MVP").
