# Cartero - Sistema de Gestão Financeira Pessoal

## Regras para o Assistente

- **Não mexa no backend sem permissão explícita do usuário.** Toda alteração em `cartero-backend/` precisa ser solicitada diretamente. O usuário cuida do backend.

## Stack

- **Backend:** Nest.js · PostgreSQL (Docker) · Prisma
- **Frontend:** Next.js · React · shadcn/ui (tema dark obrigatório)
- **Auth:** JWT (access + refresh token via cookie `HttpOnly`)
- **Deploy:** Render (backend) · Neon (PostgreSQL) · Vercel (frontend)

## Schema (campos-chave)

| Entidade | Campos relevantes |
|---|---|
| User | id, email, password (bcrypt), name, salary? |
| Bank | id, user_id, name, invoice_close_date (1-31), invoice_due_date (1-31) |
| Category | id, user_id, name, color? (hex), icon? (emoji) |
| Transaction | id, user_id, bank_id, category_id, invoice_id?, parent_id?, **person_id?**, type (INCOME\|CREDIT_CARD\|DEBIT_CARD\|PIX\|BOLETO), title, amount, description?, date |
| Invoice | id, user_id, bank_id, month (1-12), year, status (OPEN\|CLOSED\|OVERDUE\|PAID), total_amount |
| Person | id, user_id, name |
| Debt | id, user_id, person_id?, creditor_name, title, amount, description?, due_date, is_alert_enabled (default true), is_paid (default false), paid_at?, parent_id? |
| Receivable | id, user_id, person_id?, debtor_name, title, amount, description?, due_date, is_paid (default false), paid_at?, parent_id?, **transaction_id?** |

> `Transaction.person_id` e `Receivable.transaction_id` são os novos campos para a feature de transações reembolsáveis (ver seção abaixo). Ainda **não implementados** — precisam de migration no backend.

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
- Valores monetários: `R$ 1.234,56`; negativos `text-destructive`; positivos `text-paid` (faturas/income) ou `text-receivable` (recebíveis)
- Status de fatura: OPEN (azul/primary) · CLOSED (amarelo/amber) · OVERDUE (vermelho/destructive) · PAID (verde/paid)
- "Atrasado" em A Receber usa `text-destructive` (vermelho) — igual a Dívidas, **não** usar `text-pending`
- Ações (editar/deletar) aparecem apenas no hover da linha; em mobile usam `DropdownMenu` com `MoreVertical`
- Formulários: Sheet ou Dialog — nunca navegação para outra página
- Feedback: toasts para todas as ações
- Tokens CSS customizados em `globals.css` (Tailwind v4 `@theme inline`):
  - `--receivable` / `bg-receivable` / `text-receivable` → verde de recebíveis/recebidos
  - `--pending` / `bg-pending` / `text-pending` → amarelo de pendente/vencendo (não usar para "atrasado")
  - `--color-paid` / `text-paid` / `bg-paid` → verde de faturas pagas (alias de `--color-income`)

## Página de Faturas do Banco (`/banks/:id/invoices`)

**Lista:**
- Seções separadas por status: **Vencidas** (`text-destructive/90`) · **Ativas** (`text-muted-foreground/70`) · **Histórico** (`text-paid/90`)
- Ativas: mostra 3 por padrão, expand/collapse (`ACTIVE_VISIBLE = 3`); Histórico: mostra 1 (`PAID_VISIBLE = 1`)
- Fatura do mês vigente (OPEN calculado por `invoiceCloseDate`) recebe badge "Atual" (bg-primary)
- Faturas com `totalAmount = 0` são ocultadas

**Detalhe (Sheet lateral):**
- Header com tint 10% da cor do status via `statusHeaderStyle` (usa `color-mix(in oklch, var(--status) 10%, transparent)`)
- Total: `text-destructive` se OVERDUE · `text-paid` se PAID · neutro demais; tamanho `text-[22px]`
- Transações separadas em: **Transações** (normais) e **Parcelamentos** — ambas ordenadas por data decrescente
- Detecção de parcelamento: regex `/\s\d+\/\d+$/` no título — **não usar `parentId`** (primeira parcela tem `parentId = null`)

## Visão Geral (`/overview`)

### Painel "Atenção agora"

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

### Gastos por categoria

- Cada linha é clicável e navega para `/transactions?startDate=...&endDate=...&categoryId=...`
- O intervalo de datas segue o seletor de mês da visão geral
- Ícone `ExternalLink` aparece no hover para indicar navegação

### Calendário financeiro

- Exibido abaixo do grid principal, compartilha o seletor de mês
- **Não faz queries novas** — reutiliza os dados de debts, receivables, invoices e banks já carregados
- 3 tipos de evento (dots coloridos):
  - `debt` → `bg-destructive` — dívidas não pagas
  - `receivable` → `bg-receivable` — recebíveis não recebidos
  - `invoice-due` → `bg-amber-400` — faturas não pagas (usa `bank.invoiceDueDate` como dia)
- Clicar em um dia com eventos abre painel de detalhe abaixo do calendário
- **Parsing de data:** sempre usar `.slice(0, 10)` antes de `.split('-')` — `dueDate` pode vir como ISO timestamp (`"2026-06-26T00:00:00.000Z"`), que quebraria a extração do dia
- Faturas: exibe todas com `status !== PAID` e `totalAmount > 0` dentro do mês/ano — **sem filtro de status adicional**, para mostrar parcelas futuras de meses seguintes corretamente

## URL params — Dívidas e A Receber

| Param | Efeito |
|---|---|
| `?highlight=<id>` | Rola até a linha, pulso de destaque índigo, troca aba automaticamente se item estiver em Pagas/Recebidos |
| `?endDate=<YYYY-MM-DD>` | Inicializa filtro de data fim pela URL; `startDate` fica `undefined` |

`startDate` padrão é sempre `undefined` nas páginas de Dívidas e A Receber — garante que itens vencidos de meses anteriores sempre apareçam.

## URL params — Transações

| Param | Efeito |
|---|---|
| `?startDate=<YYYY-MM-DD>` | Inicializa filtro de data início |
| `?endDate=<YYYY-MM-DD>` | Inicializa filtro de data fim |
| `?categoryId=<id>` | Inicializa filtro de categoria (pre-seleciona o Select) |

Se qualquer um desses três parâmetros estiver presente na URL, o filtro padrão de "mês atual" é ignorado. Usado pela navegação da visão geral (Gastos por categoria → drill-through).

## Cache / React Query

- `staleTime: 0` global — queries revalidam ao montar, sem necessidade de F5
- Cross-invalidações críticas implementadas:
  - Mutations em `transactions` → invalida `['bank-invoices']`
  - Delete de `person` → invalida `['debts']` e `['receivables']`
  - `persons` query sem `enabled` lazy — sempre carregada

## Auth — detalhes importantes

- **Register retorna `accessToken`** → frontend faz login automático após cadastro (sem redirecionar para login)
- **Cookie de refresh token:** `HttpOnly`, `secure: true` em produção, `sameSite: 'none'` (necessário porque Render e Vercel são origens distintas — `sameSite: 'strict'` bloquearia o cookie em requisições cross-origin, derrubando o usuário)
- Interceptor Axios: 401 → chama `POST /auth/refresh` com `withCredentials: true` → atualiza `localStorage` e header → retenta a requisição original; requisições concorrentes são enfileiradas

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
- Cookie de refresh com `sameSite: 'none'` para funcionar cross-origin (Render + Vercel) ✅

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
- Auth (login/registro com auto-login após cadastro)
- Sidebar colapsável com logout no modo ícone
- Bancos, Categorias, Transações, Faturas, Dívidas, A Receber, Pessoas
- Filtros por pessoa em Dívidas e A Receber (query `personId`)
- Acessibilidade: `sr-only` em StatusDot, `aria-pressed` em tabs de filtro; mobile usa `DropdownMenu` nas páginas de Pessoas
- Painel "Atenção agora" com janela de 7 dias, urgência por cor, lógica close/due por status
- Highlight de linha via `?highlight=<id>` com animação de pulso e troca de aba automática
- Filtro pré-aplicado via `?endDate=` ao clicar em "Ver mais" no painel de atenção
- Select de pessoa com criar inline nos forms de Dívida e Recebível
- Faturas vazias ocultadas na listagem do banco ✅
- Calendário financeiro na visão geral (mês completo, dots por tipo, painel de detalhe) ✅
- Drill-through de categoria: clicar em gastos por categoria navega para transações filtradas ✅
- Página de Perfil (`/profile`) — editar nome, e-mail, senha e salário ✅ (não comitado ainda)
- Página de Orçamento (`/budget`) — visão mensal do salário vs faturas ✅ (não comitado ainda)
- Deploy: Vercel (frontend) · Render (backend) · Neon (banco)

### Frontend ⏳ Pendente
- `GET /alerts` → banner/modal de alertas ao abrir o app
- `GET /statement` → página de extrato geral

---

## Feature: Transações Reembolsáveis (⏳ Em design — não implementada)

### Contexto e motivação

Quando o usuário paga algo no cartão em nome de outra pessoa (ex: ingresso de um amigo), ele precisa registrar a transação na fatura **e** criar manualmente um recebível. São dois cadastros para a mesma coisa. Além disso, esse valor não deve sair do salário dele no cálculo mensal — quem vai pagar é a outra pessoa.

A solução é permitir **linkar uma transação a uma Person** (campo `person_id` opcional), e o backend cria o recebível automaticamente.

### Regras de negócio

**Criação:**
- Só para transações do tipo `CREDIT_CARD` (a lógica é ligada à fatura).
- Quando `person_id` está presente na criação da transação, o backend cria automaticamente um `Receivable` espelhado:
  - `person_id` = mesmo da transação
  - `debtor_name` = nome da Person
  - `title` = mesmo título da transação
  - `amount` = mesmo valor
  - `due_date` = **data de vencimento da fatura** associada à transação (invoice.due_date calculado em runtime)
  - `transaction_id` = id da transação (para rastrear a origem)
- Recebível **não tem** `is_alert_enabled` especial — segue o padrão.

**Parcelamento:**
- Se a transação é parcelada (3x R$ 100), cada parcela gera **1 receivable correspondente** (também 3x R$ 100).
- Os receivables parcelados seguem o mesmo padrão: `parent_id` na primeira, `title` = "Nome x/y".
- O `due_date` de cada receivable = `due_date` da fatura da parcela correspondente.
- Isso garante que o usuário cobra do amigo na mesma cadência que paga as parcelas.

**Sincronização (bidirecional — comportamento ainda em definição):**
- **Editar transação** (amount, title) → atualiza o receivable linkado (`transaction_id`).
- **Deletar transação** → deleta o receivable linkado (com aviso no toast: "Recebível de [Pessoa] também foi removido").
- **Deletar receivable com `transaction_id`** → comportamento a definir: deletar a transação também? Apenas desvincular? Pedir confirmação? **A IA deve ajudar o usuário a pensar nesse caso antes de implementar.**
- Pagamento do receivable (`isPaid = true`) não afeta a transação — são independentes após a criação.
- Edição manual do receivable (ex: valor parcial) também não afeta a transação — o usuário pode ajustar livremente depois.

**Visual na UI:**
- Linha de transação (página `/transactions`) → chip/badge discreto com nome da pessoa linkada.
- Detalhe da fatura (página `/banks/:id/invoices`) → mesma identificação na linha da transação.
- Formulário de criação/edição de transação → select de Person (igual ao de Dívidas/A Receber), só visível quando tipo = `CREDIT_CARD`.

### Schema changes necessários (backend — aguarda permissão)
```prisma
model Transaction {
  // ...campos existentes...
  personId   String?  @map("person_id")
  person     Person?  @relation(fields: [personId], references: [id])
}

model Receivable {
  // ...campos existentes...
  transactionId  String?      @map("transaction_id") @unique
  transaction    Transaction? @relation(fields: [transactionId], references: [id])
}
```

---

## Feature: Orçamento Mensal — página `/budget` (⚠️ Frontend implementado, backend pendente)

### Contexto e motivação

O usuário tem um `salary` no perfil e quer ver, mês a mês, quanto sobra do salário depois de pagar as faturas. Mas faturas que contêm transações reembolsáveis não devem ser integralmente descontadas do salário — parte delas será ressarcida por outras pessoas.

### Lógica da página

**Estrutura por mês:**
- O "mês" de cada fatura é determinado pelo `invoice.due_date` (data de vencimento). Lógica: o usuário recebe salário no início do mês e paga as faturas que vencem naquele mês.
- Para cada mês exibido:
  - **Base:** `salary` (do perfil do usuário)
  - **Faturas do mês:** todas as invoices com `due_date` naquele mês (qualquer banco)
  - **Total reembolsável:** soma de transações com `person_id` dentro dessas faturas
  - **Total do bolso:** `total_amount_faturas - total_reembolsável`
  - **Saldo projetado:** `salary - total_do_bolso`

**Estados da fatura no cálculo:**
- `OPEN` / `CLOSED` / `OVERDUE` → projeção (ainda não paga)
- `PAID` → realizado (já saiu do bolso)
- O mês mostra os dois: "Projetado: R$ X" e "Realizado: R$ Y" quando há mix.

**Salário histórico:**
- O `salary` atual do usuário deve afetar **apenas o mês vigente e os futuros**.
- Meses anteriores devem usar o salário que estava cadastrado naquele momento.
- Isso requer uma tabela de histórico de salário: `SalaryHistory { id, user_id, amount, effective_from (date) }`.
- Quando o usuário altera o salário, o backend insere um novo registro em vez de sobrescrever.
- **Implementação da tabela é backend — aguarda permissão.** Por enquanto, a página usa `user.salary` para todos os meses como fallback.

### API necessária (backend — aguarda permissão)
```
GET /budget?year=2026   → retorna meses do ano com breakdown: salary, invoices, reimbursable, net
```
Ou alternativamente o frontend monta o cálculo com os dados já disponíveis (invoices + transactions) sem endpoint novo.

### Rollout sugerido
1. **Fase 1** — Link transaction → person + visual nos cards (não precisa da página `/budget`)
2. **Fase 2** — Página `/budget` usando dados existentes (sem histórico de salário ainda) — **frontend pronto**
3. **Fase 3** — Histórico de salário + cálculo retroativo preciso
