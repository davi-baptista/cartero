# Cartero - Sistema de Gestão Financeira Pessoal

## Regras para o Assistente

- **Não mexa no backend sem permissão explícita do usuário.** Toda alteração em `cartero-backend/` precisa ser solicitada diretamente. O usuário cuida do backend.

## Stack

- **Backend:** Nest.js · PostgreSQL (Docker) · Prisma
- **Frontend:** Next.js · React · shadcn/ui (tema dark obrigatório)
- **Auth:** JWT (access + refresh token)
- **Deploy:** Render (backend) · Neon (PostgreSQL) · Vercel (frontend)

## Schema (campos-chave)

| Entidade | Campos relevantes |
|---|---|
| User | id, email, password (bcrypt), name, salary? |
| Bank | id, user_id, name, invoice_close_date (1-31), invoice_due_date (1-31) |
| Category | id, user_id, name, color? (hex), icon? (emoji) |
| Transaction | id, user_id, bank_id, category_id, invoice_id?, parent_id?, type (INCOME\|CREDIT_CARD\|DEBIT_CARD\|PIX\|BOLETO), title, amount, description?, date |
| Invoice | id, user_id, bank_id, month (1-12), year, status (OPEN\|CLOSED\|OVERDUE\|PAID), total_amount |
| Person | id, user_id, name |
| Debt | id, user_id, person_id?, creditor_name, title, amount, description?, due_date, is_alert_enabled (default true), is_paid (default false), paid_at?, parent_id? |
| Receivable | id, user_id, person_id?, debtor_name, title, amount, description?, due_date, is_paid (default false), paid_at?, parent_id? |

## Regras de Negócio Críticas

**Faturas:**
- Geradas automaticamente ao criar transação `CREDIT_CARD`
- Identificadas pelo **mês de fechamento**: `date <= close_date` → fatura do mês atual; `date > close_date` → fatura do mês seguinte
- Atenção à virada de ano: transação em janeiro antes do fechamento pode ser fatura de dezembro do ano anterior
- Em parcelamento, cada parcela recalcula sua própria fatura pela sua própria data
- Transições de status: `OPEN→CLOSED` no close_date, `CLOSED→OVERDUE` no due_date (cron job diário). `PAID` é manual pelo usuário
- `close_date` e `due_date` calculados em runtime a partir do banco; congelados para faturas CLOSED/PAID

**Parcelamento** (Transactions, Debts, Receivables):
- Cada parcela = 1 registro separado; `title` = "Nome x/y"
- Vinculadas por `parent_id` (UUID da primeira)
- `PATCH`/`DELETE` aceitam `?scope=ONE|NEXT|ALL` — frontend exibe modal de confirmação quando `parentId` existe

**Debts/Receivables:**
- Marcar como pago/recebido → seta `isPaid = true` e `paidAt`. Reverter → `paidAt = null`. **Não gera transação**
- Debts: alerta no dia do vencimento se `is_alert_enabled = true` e `is_paid = false`
- Só aparecem no extrato geral quando `isPaid = true`

**Persons:**
- Entidade de referência; `person_id` é opcional em debts e receivables
- `netBalance = totalReceivables - totalDebts` (pendentes vinculados à pessoa)
- Negativo = você deve mais; positivo = te devem mais

**Alertas (ao abrir o app):**
1. Faturas com `due_date = hoje` e `status != PAID`
2. Debts com `due_date = hoje`, `is_alert_enabled = true` e `is_paid = false`

## API — Filtros e Endpoints Relevantes

```
GET /transactions?startDate=&endDate=&bankId=&categoryId=&type=
GET /debts?personId=
GET /receivables?personId=
GET /persons/:id/statement?startDate=&endDate=
GET /invoices/:id          → retorna invoice com transactions incluídas
PATCH /invoices/:id        → usado para marcar PAID
DELETE|PATCH /transactions/:id?scope=ONE|NEXT|ALL
DELETE|PATCH /debts/:id?scope=ONE|NEXT|ALL
DELETE|PATCH /receivables/:id?scope=ONE|NEXT|ALL
GET /alerts                → ⏳ pendente
GET /statement             → ⏳ pendente
```

## Design System

- Tema dark obrigatório; referência visual: https://shadcnblocks-admin.vercel.app/
- Valores monetários: `R$ 1.234,56`; negativos `text-destructive`; positivos `text-green-500`
- Status de fatura: OPEN (azul) · CLOSED (amarelo) · OVERDUE (vermelho) · PAID (verde)
- "Atrasado" em A Receber usa `text-destructive` (vermelho) — igual a Dívidas, **não** usar `text-pending`
- Ações (editar/deletar) aparecem apenas no hover da linha
- Formulários: Sheet ou Dialog — nunca navegação para outra página
- Feedback: toasts para todas as ações
- Tokens CSS customizados em `globals.css` (Tailwind v4 `@theme inline`):
  - `--receivable` / `bg-receivable` / `text-receivable` → verde de recebíveis/recebidos
  - `--pending` / `bg-pending` / `text-pending` → amarelo de pendente/vencendo (não usar para "atrasado")

## Painel "Atenção agora" (overview/page.tsx)

Janela de 7 dias (`ATTENTION_DAYS_WINDOW = 7`), máximo 3 itens por seção (`ATTENTION_LIMIT = 3`).

**Faturas — lógica de exibição por status:**
- `OVERDUE` → sempre aparece; exibe "Venceu há Xd"
- `OPEN` → aparece se `invoiceCloseDate ≤ 7 dias`; exibe "Fecha em X dias / Fecha hoje / Fecha amanhã"
  - Se `invoiceCloseDate` já passou mas status ainda é `OPEN` (cron não rodou) → usa `invoiceDueDate` como fallback
- `CLOSED` → aparece se `invoiceDueDate ≤ 7 dias`; exibe "Falta X dias / Vence hoje / Vence amanhã"
- `PAID` → nunca aparece

**Dívidas e A Receber:**
- Top 3 com `dueDate ≤ hoje+7`, ordenadas por data (inclui vencidas)
- Clicar navega para `/debts?highlight=<id>` ou `/receivables?highlight=<id>`
- "Ver X itens a mais" navega para `/debts?endDate=<hoje+7>` (sem startDate)

## URL params — Dívidas e A Receber

| Param | Efeito |
|---|---|
| `?highlight=<id>` | Rola até a linha, pulso de destaque índigo, troca aba automaticamente se item estiver em Pagas/Recebidos |
| `?endDate=<YYYY-MM-DD>` | Inicializa filtro de data fim pela URL; `startDate` fica `undefined` |

`startDate` padrão é sempre `undefined` nas páginas de Dívidas e A Receber — garante que itens vencidos de meses anteriores sempre apareçam.

## Cache / React Query

- `staleTime: 0` global — queries revalidam ao montar, sem necessidade de F5
- Cross-invalidações críticas implementadas:
  - Mutations em `transactions` → invalida `['bank-invoices']`
  - Delete de `person` → invalida `['debts']` e `['receivables']`
  - `persons` query sem `enabled` lazy — sempre carregada

## Estado Atual

### Backend ✅ Completo
- Auth, Users, Banks, Categories, Transactions, Invoices, Debts, Receivables, Persons
- CommonModule + EntityValidationService
- Parcelamento em Transactions, Debts e Receivables
- Filtros em `GET /transactions`, `GET /debts`, `GET /receivables`
- `GET /persons/:id/statement` implementado
- `findOrCreateInvoice` com lógica de mês correta
- `PATCH /transactions/:id` → bloqueia edição se invoice original for PAID ✅
- Invoice sync executado no bootstrap (app.scheduler.ts) ✅

### Backend ⏳ Pendente
- `GET /alerts`
- `GET /statement`
- `PATCH /banks/:id` → recalcular status das faturas ao alterar `invoiceCloseDate`/`invoiceDueDate` (ver TODO.md)
- `PATCH /transactions/:id` → re-atribuir invoice ao alterar `date` (ver TODO.md)
- `GET /health` → endpoint de keepalive para o cron-job.org pingar a cada 10 min e manter o Render acordado
- `POST /invoices/sync` → endpoint protegido por `x-cron-secret` que executa sync de status das faturas + envia e-mail de alerta com faturas/dívidas vencidas ou vencendo hoje; chamado 1x/dia pelo cron-job.org
- **Notificações — avaliar canais alternativos ao e-mail:**
  - Push notification via Web Push (VAPID keys + Service Worker no frontend) — aparece mesmo com app fechado
  - WhatsApp via API de bot (ex: Twilio, Z-API, Evolution API)
  - Telegram bot — simples de implementar, gratuito

### Frontend ✅ Completo
- Auth (login/registro)
- Sidebar colapsável com logout no modo ícone
- Bancos, Categorias, Transações, Faturas, Dívidas, A Receber, Pessoas
- Filtros por pessoa em Dívidas e A Receber (query `personId`)
- Acessibilidade: `sr-only` em StatusDot, `aria-pressed` em tabs de filtro
- Painel "Atenção agora" com janela de 7 dias, urgência por cor, lógica close/due por status
- Highlight de linha via `?highlight=<id>` com animação de pulso e troca de aba automática
- Filtro pré-aplicado via `?endDate=` ao clicar em "Ver mais" no painel de atenção
- Select de pessoa com criar inline nos forms de Dívida e Recebível
- Faturas vazias ocultadas na listagem do banco ✅
- Deploy: Vercel (frontend) · Render (backend) · Neon (banco)

### Frontend ⏳ Pendente
- `GET /alerts` → banner/modal de alertas ao abrir o app
- `GET /statement` → página de extrato geral
