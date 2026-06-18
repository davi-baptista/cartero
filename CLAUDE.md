# Cartero - Sistema de Gestão Financeira Pessoal

## Stack

- **Backend:** Nest.js · PostgreSQL (Docker) · Prisma
- **Frontend:** Next.js · React · shadcn/ui (tema dark obrigatório)
- **Auth:** JWT (access + refresh token)
- **Deploy:** Railway (backend + DB) · Vercel (frontend)

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
- Ações (editar/deletar) aparecem apenas no hover da linha
- Formulários: Sheet ou Dialog — nunca navegação para outra página
- Feedback: toasts para todas as ações
- Tokens CSS customizados em `globals.css` (Tailwind v4 `@theme inline`):
  - `--receivable` / `bg-receivable` / `text-receivable` → verde de recebíveis/recebidos
  - `--pending` / `bg-pending` / `text-pending` → amarelo de pendente/vencendo

## Estado Atual

### Backend ✅ Completo
- Auth, Users, Banks, Categories, Transactions, Invoices, Debts, Receivables, Persons
- CommonModule + EntityValidationService
- Parcelamento em Transactions, Debts e Receivables
- Filtros em `GET /transactions`, `GET /debts`, `GET /receivables`
- `GET /persons/:id/statement` implementado
- `findOrCreateInvoice` com lógica de mês correta

### Backend ⏳ Pendente
- `GET /alerts`
- `GET /statement`

### Frontend ✅ Completo
- Auth (login/registro)
- Sidebar colapsável com logout no modo ícone
- Bancos, Categorias, Transações, Faturas, Dívidas, A Receber, Pessoas
- Filtros por pessoa em Dívidas e A Receber (query `personId`)
- Acessibilidade: `sr-only` em StatusDot, `aria-pressed` em tabs de filtro

### Frontend ⏳ Pendente
- Select de pessoa (com criar inline) nos forms de Dívida e Recebível
- `GET /alerts` → banner/modal de alertas ao abrir o app
- `GET /statement` → página de extrato geral
- Deploy: Railway + Vercel
