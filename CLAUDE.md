# Cartero - Sistema de Gestão Financeira Pessoal

## Regras para o Assistente

- **Não mexa no backend sem permissão explícita do usuário.** Toda alteração em `cartero-backend/` precisa ser solicitada diretamente. O usuário cuida do backend.

## Stack

- **Backend:** Nest.js · PostgreSQL (Docker local / Neon prod) · Prisma
- **Frontend:** Next.js · React · shadcn/ui (tema dark obrigatório)
- **Auth:** JWT (access + refresh token via cookie `HttpOnly`)
- **Deploy:** Render (backend) · Neon (PostgreSQL) · Vercel (frontend)

## Schema (campos-chave)

| Entidade | Campos relevantes |
|---|---|
| User | id, email, password (bcrypt), name, salary? |
| Bank | id, user_id, name, invoice_close_date (1-31), invoice_due_date (1-31) |
| Category | id, user_id, name, color? (hex), icon? (nome do ícone lucide), **is_system** (default false) |
| Transaction | id, user_id, bank_id, category_id, invoice_id?, parent_id?, person_id?, type (INCOME\|CREDIT_CARD\|DEBIT_CARD\|PIX\|BOLETO), title, amount, description?, date |
| Invoice | id, user_id, bank_id, month (1-12), year, status (OPEN\|CLOSED\|OVERDUE\|PAID), total_amount |
| Person | id, user_id, name |
| Debt | id, user_id, person_id?, creditor_name, title, amount, description?, due_date, is_alert_enabled (default true), is_paid (default false), paid_at?, parent_id?, **payment_transaction_id?** |
| Receivable | id, user_id, person_id?, debtor_name, title, amount, description?, due_date, is_paid (default false), paid_at?, parent_id?, **transaction_id?**, **payment_transaction_id?** |

> `Category.name` tem `@@unique([userId, name])` — não pode haver duas categorias com o mesmo nome para o mesmo usuário.
> `Receivable` tem **dois** FKs distintos para Transaction (relations nomeadas no Prisma: `ReimbursableLink` e `ReceivablePaymentLink`), que podem coexistir na mesma linha — ver seções de features abaixo.

## Regras de Negócio Críticas

**Faturas:**
- Geradas automaticamente ao criar transação `CREDIT_CARD`
- Identificadas pelo **mês de fechamento**: `date <= close_date` → fatura do mês atual; `date > close_date` → fatura do mês seguinte
- Atenção à virada de ano: transação em janeiro antes do fechamento pode ser fatura de dezembro do ano anterior
- Em parcelamento, cada parcela recalcula sua própria fatura pela sua própria data
- Transições de status: `OPEN→CLOSED` no close_date, `CLOSED→OVERDUE` no due_date (cron job diário). `PAID` é manual pelo usuário
- `close_date` e `due_date` calculados em runtime a partir do banco; congelados para faturas CLOSED/PAID
- Lógica de `findOrCreateInvoice`/`getInvoiceDueDate` foi extraída para `cartero-backend/src/common/helpers/invoice.helper.ts` (funções puras, reusadas por `TransactionsService`, `DebtsService` e `ReceivablesService`)

**Parcelamento** (Transactions, Debts, Receivables):
- Cada parcela = 1 registro separado; `title` = "Nome x/y"
- Vinculadas por `parent_id` (UUID da primeira)
- `PATCH`/`DELETE` aceitam `?scope=ONE|NEXT|ALL` — frontend exibe modal de confirmação quando `parentId` existe

**Debts/Receivables — marcar como pago/recebido:**
- Ao marcar como pago (`isPaid: false → true`), o frontend abre `MarkAsPaidDialog` pedindo **banco + forma de pagamento** (PIX/DEBIT_CARD/CREDIT_CARD/BOLETO) e o backend cria uma **Transaction espelho** automaticamente (ver feature "Transações de Pagamento" abaixo)
- Ao desmarcar (`true → false`), `UnmarkPaidWarningDialog` avisa que isso vai **excluir a transação vinculada** (incluindo a data original do pagamento) antes de confirmar
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
GET /invoices/:id          → retorna invoice com transactions incluídas (inclui category e person de cada transaction)
PATCH /invoices/:id        → usado para marcar PAID
DELETE|PATCH /transactions/:id?scope=ONE|NEXT|ALL
DELETE|PATCH /debts/:id?scope=ONE|NEXT|ALL       → PATCH com isPaid:true exige paymentBankId + paymentType
DELETE|PATCH /receivables/:id?scope=ONE|NEXT|ALL → idem
GET /budget?month=&year=  → salary, totalInvoices, totalReimbursable, netAmount, invoices[]
GET /health                → keepalive público (sem auth), retorna { status: 'ok' }, não toca no banco
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
- **Inputs de valor monetário**: usam `CurrencyInput` (`cartero-frontend/src/components/ui/currency-input.tsx`) — digitação estilo caixa/app bancário, preenche da direita pra esquerda (`00,00` → `00,01` → `00,10` → `01,00`). Usado em Transação, Dívida, Recebível e campo de Salário no Perfil. Controlado via `Controller` do react-hook-form (`value`/`onChange` numéricos)
- **Sidebar mobile** fecha automaticamente ao navegar (clicar em item do menu ou no link de perfil) — via `setOpenMobile(false)` em `SidebarNav`/`ProfileLink`, ambos dentro do `SidebarProvider`
- Tokens CSS customizados em `globals.css` (Tailwind v4 `@theme inline`):
  - `--receivable` / `bg-receivable` / `text-receivable` → verde de recebíveis/recebidos
  - `--pending` / `bg-pending` / `text-pending` → amarelo de pendente/vencendo (não usar para "atrasado")
  - `--color-paid` / `text-paid` / `bg-paid` → verde de faturas pagas (alias de `--color-income`)

## Categorias de sistema (`Category.isSystem`)

- Duas categorias são **auto-criadas pelo backend** na primeira vez que são necessárias, via `EntityValidationService.findOrCreateSystemCategory` (busca por `isSystem: true` + nome, cria se não existir):
  - **"Dívida paga"** — cor `#65a30d` (verde-oliva, puxado pro vermelho/amarelo)
  - **"Receita recebida"** — cor `#22c55e` (verde vívido)
  - Ambas usam ícone `"Lock"` (via `SYSTEM_CATEGORY_ICON` em `common/constants/system-categories.ts`), que existe só em um mapa separado (`SYSTEM_ICON_MAP` em `lib/category-icons.ts`) — **nunca aparece no seletor de ícones normal** (`CATEGORY_ICON_GROUPS`), só é resolvido para exibição
- **Nunca selecionáveis manualmente**: excluídas do Select de categoria no formulário de transação (`transaction-sheet.tsx`, via `selectableCategories = categories.filter(c => !c.isSystem)`); ainda aparecem corretamente se já atribuídas a uma transação existente
- **Protegidas no backend**: `CategoriesService.create()`/`update()` rejeitam (400) os nomes reservados (`SYSTEM_CATEGORY_NAMES`); `update()`/`remove()` bloqueiam (403) qualquer categoria com `isSystem: true`
- **Protegidas no frontend**: página `/categories` esconde os botões de editar/excluir para linhas de sistema e mostra badge "Sistema"

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
- Linha de transação mostra badge discreto com nome da pessoa vinculada (`tx.person.name`), se houver

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
  - Mutations em `transactions`, `debts` e `receivables` que podem gerar/remover transação vinculada → invalidam também `['transactions']`, `['bank-invoices']`, `['invoices']`, `['budget']`
  - `persons` query sem `enabled` lazy — sempre carregada

## Auth — detalhes importantes

- **Register retorna `accessToken`** → frontend faz login automático após cadastro (sem redirecionar para login)
- **Cookie de refresh token:** `HttpOnly`, `secure: true` em produção, `sameSite: 'lax'`. O frontend acessa o backend pelo rewrite same-origin `/api/:path*` do Next.js, que aponta para o Render; isso evita depender de cookies de terceiros entre Vercel e Render.
- Interceptor Axios: 401 → chama `POST /auth/refresh` com `withCredentials: true` → atualiza `localStorage` e header → retenta a requisição original; requisições concorrentes compartilham uma única Promise de refresh. O `AuthProvider` valida a sessão ao iniciar e renova o access token 1 minuto antes do vencimento.

## Estado Atual

### Backend ✅ Completo
- Auth, Users, Banks, Categories, Transactions, Invoices, Debts, Receivables, Persons, Budget, Health
- CommonModule + EntityValidationService (inclui `findOrCreateSystemCategory`)
- Parcelamento em Transactions, Debts e Receivables
- Filtros em `GET /transactions`, `GET /debts`, `GET /receivables`
- `GET /persons/:id/statement` implementado
- `findOrCreateInvoice`/`getInvoiceDueDate` extraídos para `common/helpers/invoice.helper.ts` (usados por Transactions, Debts e Receivables)
- `PATCH /transactions/:id` → bloqueia edição se invoice original for PAID ✅
- Invoice sync executado no bootstrap (app.scheduler.ts) ✅
- Cookie de refresh first-party via proxy `/api`, com `sameSite: 'lax'` e `secure` em produção ✅
- **Transações reembolsáveis** ✅ (ver seção própria abaixo)
- **Transações de pagamento (Dívida paga / Receita recebida)** ✅ (ver seção própria abaixo)
- **Categorias de sistema** ✅ (`isSystem`, protegidas contra edição/exclusão/colisão de nome)
- `GET /health` ✅ — keepalive público, sem tocar no banco

### Backend ⏳ Pendente
- `GET /alerts`
- `GET /statement`
- `PATCH /banks/:id` → recalcular status das faturas ao alterar `invoiceCloseDate`/`invoiceDueDate` (ver TODO.md)
- `PATCH /transactions/:id` → re-atribuir invoice ao alterar `date` (ver TODO.md)
- `POST /invoices/sync` → endpoint protegido por `x-cron-secret` que executa sync de status das faturas + envia e-mail de alerta com faturas/dívidas vencidas ou vencendo hoje; chamado 1x/dia pelo cron-job.org
- Histórico de salário (`SalaryHistory`) para cálculo retroativo preciso em `/budget`
- **Notificações — avaliar canais alternativos ao e-mail:**
  - Push notification via Web Push (VAPID keys + Service Worker no frontend) — aparece mesmo com app fechado
  - WhatsApp via API de bot (ex: Twilio, Z-API, Evolution API)
  - Telegram bot — simples de implementar, gratuito

### Infra
- `GET /health` configurado no cron-job.org para pingar a cada 10 min e manter o Render (free tier) acordado

### Frontend ✅ Completo
- Auth (login/registro com auto-login após cadastro)
- Sidebar colapsável com logout no modo ícone; **fecha automaticamente no mobile ao navegar**
- Bancos, Categorias, Transações, Faturas, Dívidas, A Receber, Pessoas, Orçamento, Perfil
- Filtros por pessoa em Dívidas e A Receber (query `personId`)
- Acessibilidade: `sr-only` em StatusDot, `aria-pressed` em tabs de filtro; mobile usa `DropdownMenu` nas páginas de Pessoas
- Painel "Atenção agora" com janela de 7 dias, urgência por cor, lógica close/due por status
- Highlight de linha via `?highlight=<id>` com animação de pulso e troca de aba automática
- Filtro pré-aplicado via `?endDate=` ao clicar em "Ver mais" no painel de atenção
- Select de pessoa com criar inline nos forms de Dívida, Recebível e Transação (CREDIT_CARD)
- Faturas vazias ocultadas na listagem do banco ✅
- Calendário financeiro na visão geral (mês completo, dots por tipo, painel de detalhe) ✅
- Drill-through de categoria: clicar em gastos por categoria navega para transações filtradas ✅
- Página de Perfil (`/profile`) — editar nome, e-mail, senha e salário ✅
- Página de Orçamento (`/budget`) — visão mensal do salário vs faturas, com breakdown de valor a receber de terceiros ✅
- `CurrencyInput` em todos os campos de valor monetário (transação, dívida, recebível, salário) ✅
- Deploy: Vercel (frontend) · Render (backend) · Neon (banco)

### Frontend ⏳ Pendente
- `GET /alerts` → banner/modal de alertas ao abrir o app
- `GET /statement` → página de extrato geral

---

## Feature: Transações Reembolsáveis (✅ Implementada)

### Contexto e motivação

Quando o usuário paga algo no cartão em nome de outra pessoa (ex: ingresso de um amigo), ele pode linkar a transação a uma `Person` e o backend cria automaticamente um `Receivable` espelho — sem precisar de dois cadastros manuais. Esse valor também é excluído do cálculo de orçamento (ver `/budget`).

### Regras de negócio implementadas

**Criação:**
- Só para transações do tipo `CREDIT_CARD`. Validado no backend (`BadRequestException` se `personId` setado com outro tipo).
- Quando `personId` está presente, o backend cria automaticamente um `Receivable` com `transactionId` = id da transação (FK `@unique`, relation nomeada `ReimbursableLink`):
  - `debtorName` = nome da Person, `title`/`amount` = mesmos da transação
  - `dueDate` = vencimento da fatura associada (via `getInvoiceDueDate`)

**Parcelamento:**
- Cada parcela gera seu próprio `Receivable` (criado no mesmo loop da transação, `receivable[i].transactionId = transaction[i].id` — join sempre pelo FK único, nunca por matching de índice/parentId entre as duas cadeias)
- Receivables parcelados têm sua própria cadeia `parentId` (não compartilhada com a da transação)

**Sincronização (`TransactionsService`):**
- **Editar transação** (amount, title, personId) → `syncLinkedReceivable` sincroniza o receivable vinculado (cria/atualiza/remove conforme o caso: pessoa removida ou tipo mudou → remove; pessoa nova sem receivable → cria; ambos presentes → sincroniza amount/title/personId)
- **Deletar transação** → cascade-deleta o receivable vinculado (`tx.receivable.deleteMany` **antes** de `tx.transaction.delete`, devido ao FK `ON DELETE SET NULL` que senão zeraria o vínculo antes do delete explícito rodar)
- **Deletar receivable com `transactionId`** → cascade-deleta a transação também (`ReceivablesService.remove()`), com aviso explícito via `DeleteLinkedWarningDialog` no frontend antes de confirmar
- Pagamento do receivable (`isPaid = true`) não afeta a transação — independentes após criação
- Edição manual do receivable (valor, título) não sincroniza de volta — aviso inline no formulário quando `transactionId` presente

**Visual na UI:**
- Badge discreto com nome da pessoa nas linhas de transação (`/transactions`) e no detalhe da fatura (`/banks/:id/invoices`)
- Select de Person no formulário de transação, visível só quando tipo = `CREDIT_CARD`, com criação inline

### Schema (implementado)
```prisma
model Transaction {
  personId String?
  person   Person? @relation(fields: [personId], references: [id])
}

model Receivable {
  transactionId String?      @unique
  transaction   Transaction? @relation("ReimbursableLink", fields: [transactionId], references: [id])
}
```

---

## Feature: Transações de Pagamento — Dívida paga / Receita recebida (✅ Implementada)

### Contexto e motivação

Marcar uma Dívida como paga ou um Receivable como recebido agora gera automaticamente uma `Transaction` espelho, registrando o fluxo de caixa real — sem precisar cadastrar a transação manualmente depois.

### Regras de negócio implementadas

**Gatilho:** no momento de marcar como pago/recebido (`isPaid: false → true`), não na criação do registro. O frontend abre `MarkAsPaidDialog` pedindo banco + forma de pagamento (PIX/DEBIT_CARD/CREDIT_CARD/BOLETO — nunca INCOME como opção).

**Debt pago:**
- Cria `Transaction` com `type` = o escolhido no modal (PIX/DEBIT_CARD/CREDIT_CARD/BOLETO), `amount`/`title` = da dívida, `date` = hoje, `categoryId` = categoria de sistema "Dívida paga"
- `Debt.paymentTransactionId` (FK `@unique`, relation `DebtPaymentLink`) guarda o vínculo
- Se `paymentType === CREDIT_CARD` → passa pela lógica normal de fatura (`findOrCreateInvoice` + incremento de `totalAmount`)

**Receivable recebido:**
- Mesma mecânica, mas `Transaction.type` é **sempre forçado a `INCOME`** no backend, independente do `paymentType` escolhido no modal (escolher CREDIT_CARD aqui é um edge case estranho mas permitido — só afeta qual fatura recebe o lançamento, o tipo continua INCOME para não distorcer os totais de gasto/receita)
- Categoria de sistema: "Receita recebida"
- `Receivable.paymentTransactionId` é um **campo distinto** de `Receivable.transactionId` (relation `ReceivablePaymentLink`) — uma mesma linha pode ter os dois simultaneamente (ex: receivable nascido de uma transação reembolsável que depois é marcado como recebido)

**Desmarcar (`true → false`):**
- `UnmarkPaidWarningDialog` avisa antes: "isso vai excluir a transação de pagamento vinculada, incluindo a data original do pagamento" — pensado especificamente para evitar perda de dado por clique acidental (desmarcar e remarcar depois)
- Confirmado → deleta a transação vinculada (e decrementa/remove a invoice se era CREDIT_CARD), zera `paymentTransactionId`

**Excluir Dívida/Receivable diretamente** (não desmarcar, apagar o registro):
- Cascade-deleta a transação de pagamento vinculada também, com `DeleteLinkedWarningDialog` (componente compartilhado, prop `kind: 'debt' | 'receivable'`) avisando antes — mesmo padrão da feature de reembolsáveis
- Receivable com **ambos** `transactionId` e `paymentTransactionId` → delete cascateia os dois, cada um via seu próprio FK (nunca colidem, são transações diferentes criadas por fluxos diferentes)

**Edição da transação gerada:** não sincroniza de volta para a Dívida/Receivable (mesma independência da feature de reembolsáveis).

**Parcelamento:** cada parcela marcada como paga/recebida gera sua própria transação (a lógica roda dentro do loop de scope já existente — funciona corretamente mesmo em teoria com `scope=ALL`, embora a UI hoje só dispare o toggle com `scope=ONE`).

### Schema (implementado)
```prisma
model Transaction {
  receivable        Receivable? @relation("ReimbursableLink")
  paymentReceivable Receivable? @relation("ReceivablePaymentLink")
  paymentDebt       Debt?       @relation("DebtPaymentLink")
}

model Debt {
  paymentTransactionId String?      @unique
  paymentTransaction   Transaction? @relation("DebtPaymentLink", fields: [paymentTransactionId], references: [id])
}

model Receivable {
  paymentTransactionId String?      @unique
  paymentTransaction   Transaction? @relation("ReceivablePaymentLink", fields: [paymentTransactionId], references: [id])
}
```

### Componentes novos (compartilhados entre Debts e Receivables)
- `cartero-frontend/src/app/(dashboard)/transactions/mark-as-paid-dialog.tsx` — modal de banco + tipo
- `cartero-frontend/src/app/(dashboard)/transactions/unmark-paid-warning-dialog.tsx` — aviso ao desmarcar
- `cartero-frontend/src/app/(dashboard)/transactions/delete-linked-warning-dialog.tsx` — aviso ao excluir registro vinculado (promovido de `receivables/`, agora com prop `kind`)

---

## Feature: Orçamento Mensal — página `/budget` (✅ Implementado)

### Lógica implementada

**Backend (`GET /budget?month=&year=`):**
- `totalInvoices` = soma de `totalAmount` de todas as invoices do usuário no mês/ano (qualquer banco)
- `totalReimbursable` = soma de `amount` das transações `CREDIT_CARD` com `personId` não nulo, dentro dessas invoices (via `Prisma.aggregate`)
- `netAmount = totalInvoices - totalReimbursable`
- `salary` = `user.salary` atual (sem histórico — ver pendências)
- Retorna também `invoices[]` (mesma forma de `GET /invoices`) para a listagem da página

**Frontend (`cartero-frontend/src/app/(dashboard)/budget/page.tsx`):**
- Navegação por mês/ano com setas (estado local, sem persistir na URL)
- Saldo projetado = `salary - netAmount` (exclui valor reembolsável do cálculo)
- Barra de progresso: `netAmount / salary` (verde <70%, âmbar 70-100%, vermelho >100%)
- Linha de detalhamento (só quando `totalReimbursable > 0`): "R$ X em faturas · R$ Y a receber de terceiros · R$ Z líquido" — evitar o termo "reembolsável" sozinho na UI, soa como algo cancelado/estornado
- Paid/pending exibidos lado a lado como detalhamento informativo (não como projetado/realizado separados no saldo principal)
- Sem salário cadastrado → aviso com link para `/profile`

### Pendente
- Histórico de salário (`SalaryHistory { id, user_id, amount, effective_from }`) para que alterar o salário atual não afete retroativamente a projeção de meses passados — hoje `user.salary` é usado para todos os meses
