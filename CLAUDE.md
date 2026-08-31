# Cartero - Sistema de Gestão Financeira Pessoal

## Regras para o Assistente

- **Não mexa no backend sem permissão explícita do usuário.** Toda alteração em `cartero-backend/` precisa ser solicitada diretamente. O usuário cuida do backend.

## Browser Automation

Use `agent-browser` for browser-based validation whenever a task changes
navigation, overlays, URL state, Back/Forward behavior, responsive UI, or another
interaction that cannot be fully proven by unit/integration tests.

Browser validation **complementa** os testes automatizados, nunca os substitui:
roda como quality gate adicional, depois de `test` / `typecheck` / `build`.

Core workflow:

1. Suba o Chrome dedicado e conecte (ver "Launch local" abaixo) — nesta maquina
   o auto-launch do `agent-browser open` nao e confiavel.
2. `agent-browser open <url>`
3. `agent-browser snapshot -i`
4. Interaja usando os refs (`@eN`) devolvidos pelo snapshot.
5. Re-snapshot apos navegacao ou mudanca significativa de UI.
6. Valide o **estado visivel real e a URL real** — nunca apenas presenca no DOM.

Numa rodada diagnostica, nao corrigir achados incidentais. Reporte-os
separadamente, salvo se bloquearem a tarefa em andamento.

### Launch local (workaround desta maquina)

O auto-launch falha aqui: o Chrome for Testing delega a sessao a um processo-filho
e sai sem escrever `DevToolsActivePort`. Suba uma instancia **dedicada** com CDP e
conecte o agent-browser a ela.

```powershell
$chrome = "$env:USERPROFILE\.agent-browser\browsers\chrome-152.0.7977.64\chrome.exe"
$prof   = "$env:LOCALAPPDATA\Temp\cartero-agent-browser-validation"
$port   = 9333   # confira que esta livre; resto de sessao anterior pode ocupar 9222

if (Test-Path $prof) { Remove-Item -Recurse -Force $prof -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $prof | Out-Null

Start-Process -FilePath $chrome -NoNewWindow -ArgumentList `
  "--headless=new","--no-sandbox","--disable-gpu","--no-first-run",`
  "--no-default-browser-check","--user-data-dir=$prof",`
  "--remote-debugging-address=127.0.0.1","--remote-debugging-port=$port","about:blank"
Start-Sleep -Seconds 10

# ATENCAO: o processo lancado DELEGA e sai. O PID real da sessao e quem
# detem o socket CDP — nunca o `.Id` devolvido por Start-Process.
$owned = (Get-NetTCPConnection -State Listen -LocalPort $port | Select-Object -First 1).OwningProcess
$owned | Out-File "$prof\OWNED_PID"
```

```bash
agent-browser connect 9333   # uma vez por sessao de Chrome
```

Antes de conectar, confirme que o dono da porta usa o perfil dedicado — porta
ocupada por resto de sessao anterior faria o agent-browser conectar na instancia
errada:

```powershell
(Get-CimInstance Win32_Process -Filter "ProcessId = $owned").CommandLine `
  -like '*cartero-agent-browser-validation*'   # precisa ser True
```

Regras da instancia de validacao:

- CDP escuta **somente em `127.0.0.1`**, em porta dedicada (9333). Nunca expor a
  interfaces externas; nunca alterar firewall ou rede por causa disso.
- `--user-data-dir` **exclusivo** de validacao
  (`cartero-agent-browser-validation`), fora do repositorio.
- **Nunca** reutilizar perfil pessoal de Chrome ou de Brave, e nunca anexar a uma
  sessao de navegador pessoal ja aberta.

### Cleanup — encerrar somente a sessao que voce iniciou

Encerre **apenas** a process tree do PID registrado em `OWNED_PID` (o dono do
socket CDP, capturado no launch):

```powershell
$owned = [int](Get-Content "$prof\OWNED_PID" | Select-Object -First 1)

# Arvore descendente do PID owned — ownership, nao matching por nome/path.
$all = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'"
$ids = [System.Collections.Generic.List[int]]@($owned)
$q   = [System.Collections.Generic.Queue[int]]@($owned)
while ($q.Count -gt 0) {
  $cur = $q.Dequeue()
  foreach ($c in $all) {
    if ($c.ParentProcessId -eq $cur -and -not $ids.Contains([int]$c.ProcessId)) {
      $ids.Add([int]$c.ProcessId); $q.Enqueue([int]$c.ProcessId)
    }
  }
}
foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
```

O `Win32_Process` acima e usado apenas para **caminhar a arvore a partir do PID
owned**, nunca para selecionar processos por nome ou perfil.

**PROIBIDO** encerrar browsers por matching amplo. Nunca use descoberta de
processos por:

- nome (`chrome`, `chromium`, `brave`, `msedge`);
- `Path` generico — processos-filho herdam o caminho do pai e o filtro **nao**
  isola instancias;
- substring de command-line, wildcard, `grep`/`pkill` amplo.

Exemplos proibidos: `Get-Process chrome | Stop-Process`, `pkill -f chrome`,
`taskkill /IM chrome.exe`.

O `--user-data-dir` identificavel serve para **diagnostico**, nao como
autorizacao para matar processos: ownership por PID e a fonte primaria do
cleanup. Sem o PID, prefira deixar a instancia rodando e reportar.

## Stack

- **Backend:** Nest.js · PostgreSQL (Docker local / Neon prod) · Prisma
- **Frontend:** Next.js · React · shadcn/ui (tema dark obrigatório)
- **Auth:** JWT (access + refresh token via cookie `HttpOnly`)
- **Deploy:** Render (backend) · Neon (PostgreSQL) · Vercel (frontend)

## Schema (campos-chave)

| Entidade | Campos relevantes |
|---|---|
| User | id, email, password (bcrypt), name, **salary?** (cache do mês corrente — fonte é SalaryHistory) |
| SalaryHistory | id, user_id, amount, **month** (1-12), **year**, `@@unique([userId, year, month])` |
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
- Entidade de referência; `person_id` é opcional em debts e receivables (contraparte por nome livre continua válida)
- **O consolidado é ALL-TIME** — ver seção "Consolidado de Pessoas" abaixo
- `netBalance = receivablePending - debtPending`, ambos somando TODAS as pendências (sem recorte de mês)
- Negativo = você deve mais; positivo = te devem mais. **Saldo zero ≠ quitado**

**Alertas (ao abrir o app):**
1. Faturas com `due_date = hoje` e `status != PAID`
2. Debts com `due_date = hoje`, `is_alert_enabled = true` e `is_paid = false`

## API — Filtros e Endpoints Relevantes

```
GET /transactions?startDate=&endDate=&bankId=&categoryId=&type=
GET /debts?personId=
GET /receivables?personId=
GET /persons/:id/statement?startDate=&endDate=   → o intervalo recorta APENAS period/history (por paidAt); summary e pending são all-time
GET /invoices/:id          → retorna invoice com transactions incluídas (inclui category e person de cada transaction)
PATCH /invoices/:id        → usado para marcar PAID
DELETE|PATCH /transactions/:id?scope=ONE|NEXT|ALL
DELETE|PATCH /debts/:id?scope=ONE|NEXT|ALL       → PATCH com isPaid:true exige paymentBankId + paymentType
DELETE|PATCH /receivables/:id?scope=ONE|NEXT|ALL → idem
GET /budget?month=&year=  → salary (do PERÍODO), salaryKnown, salaryEffectiveFrom, remaining, committedPct, debts{dueInMonth,priorCarry,total,priorCarryItems}, receivables{dueInMonth,count} (informativo), totalInvoices, totalReimbursable, netAmount, invoices[]
GET /salary?year=&month=   → { known, amount, effectiveFrom } — resolve a renda da competência
PUT /salary                → { amount, month, year } — upsert idempotente da competência
GET /health                → keepalive público (sem auth), retorna { status: 'ok' }, não toca no banco
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

- **Três** categorias são auto-criadas pelo backend na primeira vez que são necessárias, via `EntityValidationService.findOrCreateSystemCategory` (busca **apenas por nome** — a unicidade é `(userId, name)`, então filtrar por `isSystem` faria o create seguinte violar a constraint):
  - **"Dívida paga"** — cor `#65a30d` (verde-oliva, puxado pro vermelho/amarelo)
  - **"Receita recebida"** — cor `#22c55e` (verde vívido)
  - **"Assinatura"** — cor `#8b5cf6` (violeta) — default dos lançamentos gerados por Subscription quando nenhuma categoria é escolhida
  - Todas usam ícone `"Lock"` (via `SYSTEM_CATEGORY_ICON` em `common/constants/system-categories.ts`), que existe só em um mapa separado (`SYSTEM_ICON_MAP` em `lib/category-icons.ts`) — **nunca aparece no seletor de ícones normal** (`CATEGORY_ICON_GROUPS`), só é resolvido para exibição
- **Categoria manual homônima NÃO é promovida**: se o usuário já tem uma categoria chamada "Assinatura" com `isSystem: false`, ela é **reutilizada como está** — `isSystem`, ícone e cor dele permanecem. A versão anterior a convertia em categoria de sistema como efeito colateral de criar uma assinatura, e ela deixava de ser editável e excluível sem caminho de volta pela UI
- **Categorias já marcadas como `isSystem` são preservadas**: não há como distinguir uma criada assim de uma adotada indevidamente antes da correção, então nenhuma despromoção automática é tentada
- 5 call sites: pagar dívida (`DebtsService.update`), receber recebível (`ReceivablesService.update`), criar/editar assinatura (`SubscriptionsService.resolveCategory`) e os dois ramos do settle de pessoa (`PersonsService.settle`)
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

**Esta é a superfície de alerta dentro do app.** Não existe `GET /alerts`, e
nada o espera: o painel compõe no cliente as listas que já carrega
(`invoices`, `debts`, `receivables`, `banks`), sem endpoint agregador. Cobre
mais que o previsto originalmente — a janela é de 7 dias, não só "vence hoje",
e itens em atraso de meses anteriores continuam aparecendo.

**Web Push é outra camada**, não sinônimo. O painel é consultável dentro do
app; o push (`NotificationsService.runDueDateCheck`, disparado por
`POST /notifications/run`) alcança o usuário com o app fechado e respeita
`Debt.isAlertEnabled`. As duas coexistem e nenhuma substitui a outra.

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

## Extrato (`/transactions`) — o histórico global

"Histórico do que aconteceu, na data em que aconteceu." É a superfície do
movimento financeiro consolidado: entradas, saídas, cartão, parcelamentos e
compras de terceiros, com filtros de período, tipo, banco, categoria e busca.

Não existe `GET /statement`, e nada o espera. O extrato geral é `GET
/transactions` — a rota nasceu antes do nome que o planejamento tinha imaginado.

### Histórico, não competência

O Extrato **não** tem cards agregados. Uma compra de R$ 122,90 em 5x aparece por
R$ 122,90 na data em que aconteceu, o que é correto para o histórico — mas sob um
card "Gastos" afirmaria um desembolso de R$ 122,90 no mês, quando a fatura cobra
R$ 24,58. O número estava certo; o rótulo é que mentia.

"Quanto sai do bolso neste mês" é pergunta do **Orçamento**. Manter as duas na
mesma tela convidava a somar universos diferentes. `statement-scope.spec.ts`
vigia essa ausência.

### Pagamentos de dívida e cobrança são opt-in

Marcar uma Debt como paga ou um Receivable como recebido **só** gera Transaction
quando `createExpenseOnDebtPaid` / `createIncomeOnReceivablePaid` estão ligadas —
duas caixas no Perfil, desligadas por padrão. Com elas ligadas, os pagamentos
entram no Extrato como qualquer lançamento.

É escolha do usuário, nunca comportamento obrigatório: quem controla dívidas fora
do fluxo de caixa não quer o espelho.

### Não confundir com o extrato de Pessoa

`GET /persons/:id/statement` é outra feature: recorta a relação com **uma
pessoa** (Debt + Receivable, `summary` all-time e `period` por `paidAt`). O
Extrato recorta o **período do usuário** sobre Transactions. Nomes parecidos,
universos distintos.

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
- `PATCH /transactions/:id` → re-atribui a invoice quando muda `date`, `bankId`, `type`, `amount` ou `isRefund`: desconta da fatura anterior, recalcula a nova por `findOrCreateInvoice` e ajusta os `totalAmount` ✅
- `PATCH /banks/:id` → alteração do ciclo de faturamento propaga para as faturas elegíveis ✅ (ver seção própria abaixo)
- Invoice sync executado no bootstrap (app.scheduler.ts) ✅
- Cookie de refresh first-party via proxy `/api`, com `sameSite: 'lax'` e `secure` em produção ✅
- **Transações reembolsáveis** ✅ (ver seção própria abaixo)
- **Transações de pagamento (Dívida paga / Receita recebida)** ✅ (ver seção própria abaixo)
- **Categorias de sistema** ✅ (`isSystem`, protegidas contra edição/exclusão/colisão de nome)
- `GET /health` ✅ — keepalive público, sem tocar no banco
- **Web Push** ✅ — `NotificationsService` (VAPID + `web-push`), `POST /notifications/subscribe` e `POST /notifications/run`; Service Worker em `public/sw.js`

### Backend ⏳ Pendente
- `POST /invoices/sync` → endpoint protegido por `x-cron-secret` que executa sync de status das faturas + envia e-mail de alerta com faturas/dívidas vencidas ou vencendo hoje; chamado 1x/dia pelo cron-job.org
- **Notificações — avaliar canais alternativos ao e-mail:**
  - WhatsApp via API de bot (ex: Twilio, Z-API, Evolution API)
  - Telegram bot — simples de implementar, gratuito

### Infra
- `GET /health` configurado no cron-job.org para pingar a cada 10 min e manter o Render (free tier) acordado

### Endpoints de cron (executor externo)

Ambos autenticam pelo **mesmo** `CRON_SECRET`, via header `x-cron-secret` com o
valor **cru** — não é `Authorization: Bearer`. Não existe prefixo `/api`: o
backend não usa `setGlobalPrefix`, então o path é literal. O host é o do
**backend** (Render), nunca o do frontend.

| Rotina | Método | Path | Header | Sucesso | Falha |
|---|---|---|---|---|---|
| Geração de assinaturas | `POST` | `/subscriptions/run-all` | `x-cron-secret` | `201` quando `failed = 0` | `500` quando `failed > 0`; `401` se o segredo não conferir |
| Alerta de vencimentos | `POST` | `/notifications/run` | `x-cron-secret` | `2xx` | `401` se o segredo não conferir |

- **`skipped` não é falha**: fatura já paga é decisão do domínio e mantém a resposta em sucesso. Só `failed > 0` produz não-2xx
- O `500` de falha parcial **não reverte** nada — os ciclos confirmados permanecem. O retry provocado pelo status é seguro: `lastGeneratedFor` usa update condicional e a criação usa `creationKey`
- Corpo do `500`: `{ code: 'SUBSCRIPTION_GENERATION_PARTIAL_FAILURE', summary }` com `generated`/`skipped`/`failed`/`failures[]` sanitizados (sem stack, sem erro cru do Prisma)
- `CRON_SECRET` é validado no boot e **recusa string vazia ou só espaços** — antes a aplicação subia e o guard rejeitava 100% das chamadas com 401, sem indicar a causa
- `CronSecretGuard` vive em `src/auth/` (ao lado de `JwtAuthGuard`); antes estava em `notifications/` e era importado por `subscriptions/`, uma dependência invertida

### Executores da geração de assinaturas

Dois, ambos idempotentes; a proteção de concorrência impede duplicidade.

| Executor | Gatilho | Origem no log |
|---|---|---|
| Cron externo (primário) | `POST /subscriptions/run-all`, 1x/dia | `external-cron` |
| Runner do dashboard (recuperação) | mount do layout autenticado | `dashboard` |

`AppScheduler` **não** gera assinaturas — sua única rotina é `syncInvoiceStatus`
(transição de `InvoiceStatus`), no bootstrap e à meia-noite. **Não há execução
duplicada de Subscription.**

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
- `DeleteLinkedWarningDialog` (compartilhado, props `kind: 'debt' | 'receivable'` e `link: 'payment' | 'purchase'`) oferece **escolha explícita**: "Manter a transação" (padrão, botão primário) ou "Excluir as duas". O padrão preserva porque a transação é o registro do dinheiro que se moveu de fato — junto com a data original, é o dado que ninguém reconstrói depois
- A escolha viaja como `?preserveTransaction=true` para `DELETE /debts/:id` e `DELETE /receivables/:id`
- Receivable com **ambos** `transactionId` e `paymentTransactionId` → delete cascateia os dois, cada um via seu próprio FK (nunca colidem, são transações diferentes criadas por fluxos diferentes)

**Edição da transação gerada:** não sincroniza de volta para a Dívida/Receivable (mesma independência da feature de reembolsáveis).

### Integridade de quitação (Fase 8A)

Guardas centralizadas em `common/helpers/settlement.guard.ts` — a mesma fonte para os dois domínios, porque a auditoria encontrou proteção cuidadosa num sentido e nenhuma no inverso.

| Situação | Código | Bloqueia | Libera |
|---|---|---|---|
| Dívida paga | `PAID_DEBT_EDIT_BLOCKED` | valor, contraparte, datas | título, descrição, `isPaid: false` |
| Cobrança recebida | `PAID_RECEIVABLE_EDIT_BLOCKED` | idem | idem |
| Cobrança automática (`transactionId`) | `AUTOMATIC_RECEIVABLE_MANAGED_BY_TRANSACTION` | edição financeira **e** delete direto | título, descrição |
| Transação que é comprovante | `PAYMENT_TRANSACTION_LINKED` | `amount`, `date`, `bankId`, `type`, `isRefund`, `personId` | título, descrição, categoria |

- A condição é **`changesSettlementFacts` (comparação de valor), não `isPaid`** — se a guarda disparasse pelo simples estado de pago, `{ isPaid: false }` seria recusado e o registro ficaria preso: incorrigível porque está pago, e não reabrível porque a guarda recusa. `settlement-unmark.spec.ts` existe só para vigiar essa propriedade
- **Não existe o invariante `isPaid = true` → `paymentTransactionId != null`.** Com `createExpenseOnDebtPaid` desligado, pagar não gera transação — e isso é escolha legítima do usuário
- `GET /banks` já exclui `isSystem`, mas o banco de sistema chega ao frontend **embutido** nos registros (`transaction.bank`). `lib/bank-display.ts` (`bankDisplayName` / `isSelectableBank`) resolve o rótulo para "Não informado" e o mantém fora dos seletores — o nome técnico `__system_receivables__` nunca aparece
- `NotificationsService` passou a respeitar `Debt.isAlertEnabled`: o campo era gravável, tinha switch rotulado no formulário e sino cortado na linha, mas **nenhum leitor o consultava** — desligar o alerta não desligava nada

### Apresentação de status (Dívidas e A Receber)

- `lib/settlement-status.ts` é a fonte única: `settlementStatus` deriva de `isPaid` + `dueDate` (comparação por string ISO, nunca `Date` — evita o off-by-one em fuso negativo). **Sem enum persistido**: o status muda de valor sozinho à meia-noite
- `components/settlement-status-dot.tsx` substitui as duas cópias byte a byte de `StatusDot`
- Vocabulário: **"Em atraso"** — nunca "Vencido", "Vencida" ou "Atrasada". Os contadores das duas páginas usavam palavras diferentes para o mesmo estado; agora saem de `overdueCountLabel`
- Pendente usa `text-pending` (âmbar). Recebível pendente **não** usa verde só por ser dinheiro entrando — verde é conclusão
- As duas páginas distinguem `loading` / `error` / `success-empty` / `success-data`; o vazio exige `isSuccess`, e o erro tem `role="alert"` com botão de retry. Antes, API fora do ar exibia "Nenhuma dívida pendente"

**Formulário de cobrança automática:** campos financeiros desabilitados, com link "Ver a compra" (`/transactions?startDate=&endDate=` no dia do `occurredAt`). O aviso anterior dizia que as alterações "não afetam a transação original" — verdade, mas omitia que eram descartadas por `syncLinkedReceivable` sem avisar.

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

## Testes do frontend (Fase 10) ✅

`npm test` no `cartero-frontend` roda **Vitest** sobre lógica pura — 103 testes
em 5 arquivos. Sem jsdom, sem Testing Library, sem `@vitejs/plugin-react`: o que
precisa de proteção são as funções que decidem valores financeiros, e todas são
puras. (O `plugin-react` também conflita com a árvore de babel do shadcn.)

| Arquivo | Protege |
|---|---|
| `money-semantics.spec.ts` | movimentado / sua parte / de outras pessoas, estornos, reconciliação de categorias |
| `calendar-events.spec.ts` | competência, direção, status, dedupe, ordenação, dia civil |
| `person-statement.spec.ts` | mensagem de WhatsApp, saldo zero ≠ quitação, normalização de telefone |
| `settlement-status.spec.ts` | status derivado e vocabulário oficial |
| `financial-matrix.spec.ts` | coerência CRUZADA entre as superfícies |

`financial-matrix.spec.ts` é o que faltava: cada spec de módulo protegia uma
superfície, e nenhum garantia que elas concordassem. Ele fixa o cenário canônico
(fatura R$ 1.000 = R$ 700 próprios + R$ 300 da Eva) e afirma que **nenhuma
superfície devolve R$ 400** — o número que aparece quando o recebível desconta
duas vezes.

## Calendário financeiro (Fase 9D) ✅

### A pergunta

> "Quais fatos financeiros têm uma data relevante neste mês?"

Cada evento fica no mês da **sua própria data** — nunca é movido para o mês visível. `lib/calendar-events.ts` é puro (sem fetch), o que permitirá testá-lo na Fase 10.

| Evento | Fonte | Data | Valor |
|---|---|---|---|
| `invoice-due` | Invoice | `dueDate` persistida | **bruto** + decomposição |
| `debt` | Debt | `dueDate` | valor da dívida |
| `receivable` | Receivable | `dueDate` (já sincronizada) | valor da cobrança |
| `expense` / `income` / `refund` | Transaction | `date` | valor da transação |

**`CREDIT_CARD` não gera evento individual.** Crédito é representado pelo vencimento da fatura; incluir a compra criaria dois eventos para o mesmo dinheiro — um no dia da compra, outro quando a fatura vence. A compra continua no Extrato. Crédito sem `invoiceId` (legado) simplesmente não gera evento — nenhuma data é inventada.

### Overdue anterior NÃO reaparece — decisão de produto

Uma dívida vencida em 15/06 e ainda aberta pertence ao calendário de **junho**. Mover a data para agosto mentiria sobre quando o fato aconteceu. "Atenção agora" é a superfície que garante a permanência visual do que está em atraso — as duas respondem perguntas diferentes.

### Fatura: bruto com decomposição

O valor primário é o **bruto** — é o que o banco cobra no vencimento. Quando há terceiros, uma linha secundária diz "R$ 700 seus · R$ 300 de outras pessoas"; sem terceiros ela é omitida (densidade).

Isso explica por que o mesmo mês mostra R$ 1.000 no calendário e R$ 700 em "Seus gastos por categoria" — e **não** há compensação: um recebível de R$ 300 no mesmo dia coexiste com a fatura de R$ 1.000, sem abatê-la.

O breakdown é um `Map` por `invoiceId` construído **uma vez**, fora do laço — nenhuma query por fatura.

### Cor = direção, não status

`out` (destructive) · `in` (receivable) · `neutral` (pending).

A versão anterior pintava recebível pendente de verde, o mesmo token de "recebido": dinheiro que talvez entre lido como dinheiro que entrou. Status e direção são conceitos distintos — uma saída já paga continua sendo saída.

Tipo e status aparecem em **texto** (`Fatura · Em atraso`), então a informação não depende de cor. Vocabulário oficial: "Em atraso", nunca "Vencida".

### Fatos concluídos permanecem

Fatura paga, dívida paga e cobrança recebida continuam no calendário do mês em que venceram, com status `Paga` / `Pago` / `Recebido` — o calendário é registro de fatos, não lista de pendências.

Uma cobrança com vencimento 10/08 recebida em 20/08 gera **dois** eventos legítimos: o vencimento (dia 10) e a entrada real (dia 20). O mesmo vale para dívida paga com transação-espelho. Não é duplicidade — o calendário não soma eventos num total.

### Sem total diário

Auditado: não existia e não foi criado. Somar vencimento de fatura (bruto), dívida, recebível e movimentações num único número misturaria universos incompatíveis.

### Detalhes

- Identidade estável `<kind>:<id>` — antes a key era o índice do array, que impedia detectar a mesma entidade entrando duas vezes
- Ordem no dia: fatura → dívida → recebível → saída → estorno → receita, com título como desempate. Antes era a ordem incidental dos arrays
- Linhas são `Link` (teclado + menu de contexto), com `aria-label` completo: tipo, título, valor, status e decomposição
- Navegação: fatura → `/banks/:id/invoices`; dívida/cobrança → `?highlight=`; transação → o deep-link do Extrato da Fase 8B, sem um segundo mecanismo
- Dia civil por string ISO (`formatDateValue`), não `new Date().getDate()`
- `key={ano-mês}` remonta a seção ao trocar de mês, no lugar do efeito que chamava `setState`
- Erro **parcial**: o que carregou continua visível com aviso "Alguns eventos não puderam ser carregados" e retry. O vazio só aparece quando todas as fontes tiveram sucesso
- **Zero requests novas** — reusa a resposta de `/transactions?invoicePeriod=true` que já alimenta as categorias

## Visão Geral — semântica dos widgets (Fase 9C) ✅

### Os três widgets

A Visão Geral **não tem cards de Receitas/Gastos/Saldo** — a auditoria da Fase 9C confirmou que eles nunca existiram. Criar um card de renda planejada aqui é explicitamente fora de escopo: `SalaryHistory` é planejamento, `Transaction INCOME` é receita realizada.

| Widget | Pergunta | Fonte | Recorte |
|---|---|---|---|
| Seus gastos por categoria | "quanto EU gastei nesta competência?" | `GET /transactions?invoicePeriod=true` | competência da fatura (crédito) / data (débito, PIX, boleto) |
| Atenção agora | "o que exige minha atenção AGORA?" | `GET /invoices`, `/debts`, `/receivables` sem filtro | janela móvel de 7 dias a partir de hoje, **independente do mês selecionado** |
| Calendário | "o que acontece neste mês?" | as mesmas listas já carregadas | mês exibido |

`invoicePeriod=true` casa por `invoice: { year, month }` — a relação **real e persistida**, nunca derivada do Bank (o que a Fase 6B corrigiu). O ramo alternativo usa `invoiceId: null` + `date`, e é esse `null` que impede uma compra de crédito casar nos dois ramos.

### Categorias reconciliam com o total

`sum(categoryRows.amount) === ownExpenseTotal`, e o total agora aparece no cabeçalho para a reconciliação ser verificável.

- Só `isOwnExpense` (sem `personId`) — compras de terceiros ficam fora
- Estornos abatem a própria categoria (`expenseSignedAmount`), nunca inflam receita
- **Categoria com estorno maior que o gasto CONTINUA na lista.** Antes era descartada por `amount > 0`: com R$ 300 em Restaurantes, R$ 350 de estorno e R$ 200 em Mercado, a tela exibia R$ 200 enquanto o gasto real era R$ 150. Sumir com a linha escondia justamente o fato interessante
- Linha negativa: barra vazia, valor em `text-receivable`, percentual `—`. O denominador do percentual usa só as categorias positivas — a soma líquida poderia ser zero e produzir `Infinity`
- Compra de terceiro tem benefício **uma única vez**: reduz a sua parte da fatura, e o recebível automático correspondente não reduz de novo (1000 bruto − 300 de Eva = 700, nunca 400)

### Atenção agora

- Deriva de `new Date()` e das listas **não filtradas** — navegar de agosto para julho não muda o universo. Microcopy "Independente do mês selecionado" existe porque o seletor fica logo acima
- Itens em atraso de meses anteriores continuam visíveis; resolvidos (Debt paga, Receivable recebido, Invoice PAID) não entram
- Faturas: `OVERDUE` sempre; `OPEN` se fecha em ≤7 dias (com fallback para `dueDate` quando o fechamento passou e o cron não rodou); `CLOSED` se vence em ≤7 dias
- Não reutiliza `priorCarry` do Budget: aquele é snapshot de planejamento de um mês, este é estado atual

### Estados por widget

Cada widget tem query independente, então o erro é **localizado**: categorias podem falhar enquanto o painel de atenção carrega. `WidgetError` com `refetch` (nunca `window.location.reload()`).

Antes não havia `isError` em nenhuma query — uma falha de API renderizava "Sem gastos no período", o app afirmando que o usuário não gastou nada quando apenas não conseguiu saber.

### O que a Visão Geral NÃO faz

- Não inclui `Debt` nas métricas financeiras (só Transactions/Invoices) — o Budget é a superfície de obrigação
- Não projeta futuro: nem `SalaryHistory`, nem Subscription não gerada, nem Receivable hipotético. Compromissos é a superfície de projeção
- Recebível pendente **não** é receita realizada; só a `paymentTransaction` INCOME é

## Semântica do Orçamento (Fase 9B) ✅

### O que a tela responde

> "Quanto da minha renda está comprometido por obrigações e gastos atribuídos a este mês?"

Visão de **planejamento mensal**. Não é saldo bancário, extrato, consolidado all-time da pessoa nem encontro de contas.

### Fim da compensação Debt × Receivable

A versão anterior calculava `debt - min(receivable, debt)` por pessoa. Com R$ 500 dos dois lados o orçamento mostrava **R$ 0** de dívida — e o `.filter(amount > 0)` fazia a pessoa **desaparecer da lista**, então a obrigação sumia da tela, não só do total.

O Cartero não faz encontro de contas: quitar liquida cada item pelo próprio valor. Recebível é dinheiro **esperado**, não pagamento realizado.

- Recebíveis **nunca** reduzem `debt`, `totalDebts`, `totalToPay` ou `committedPct`
- Aparecem como informação (`receivables.dueInMonth`), com a microcopy "não abate o valor acima"
- **Sem saldo líquido nesta superfície**, deliberadamente — reintroduziria a ambiguidade
- O subtítulo "já descontado R$ X que <pessoa> te deve" foi removido das linhas

### Composição das dívidas

| Campo | Regra |
|---|---|
| `debts.dueInMonth` | `dueDate` dentro do mês |
| `debts.priorCarry` | `dueDate < monthStart` **E** (`paidAt` nulo **OU** `paidAt >= monthStart`) |
| `debts.total` | `dueInMonth + priorCarry` |

**A condição temporal usa `paidAt`, não `isPaid`.** Reconstruir agosto com o estado de hoje diria que uma dívida paga em setembro já estava resolvida em agosto — e ela não estava.

| Dívida vence jun, paga em… | jul | ago | set |
|---|---|---|---|
| nunca | carry | carry | carry |
| julho | carry | — | — |
| agosto | carry | carry | — |

- A repetição entre meses é **intencional**: a mesma obrigação atravessando snapshots mensais, não despesa nova. A seção "Pendências anteriores" existe para deixar isso claro
- O vencimento **original** é preservado — nunca reescrito como se fosse deste mês
- `isPaid: true` com `paidAt: null` (legado) é tratado como **ainda aberta**: sem saber quando foi paga, não inventamos data. Exibir a mais é recuperável; sumir com uma obrigação não é
- **Dívida futura fica fora** do mês atual — decisão de produto, não bug

### Equação final

```
totalToPay = netAmount + totalDirectPayments + debts.total
netAmount  = invoice.totalAmount - thirdPartyAmount   (sua parte; fatura bruta preservada)
```

Recebíveis não entram. Duas duplicidades de sinal oposto são barradas por teste:

1. **Compra de terceiro** reduz a sua parte da fatura; o recebível automático correspondente **não** reduz de novo (fatura 1000 com 300 de Eva → 700, nunca 400)
2. **Dívida paga** com transação-espelho: `paymentDebt: null` exclui a transação dos pagamentos diretos (500, nunca 1000). Com `createExpenseOnDebtPaid = false` a obrigação existe igualmente — ela não depende da transação

### UI

- Aviso discreto no total quando há carry: "Inclui R$ X de pendências anteriores"
- Seção "Pendências anteriores" só renderiza quando existe algo (sem "— R$ 0")
- O cabeçalho de "Dívidas" usa `dueInMonth`, não `total`: as linhas listadas são as do mês, e precisam fechar com o título
- `DEBT_STATUS_CONFIG.OVERDUE` passou de "Vencida" para **"Em atraso"** — esta tela tinha ficado fora da padronização da Fase 8A

### Rollover da renda (hardening da 9A)

`User.salary` ficava **obsoleto na virada do mês sem nenhuma escrita**: com histórico ago=5000 e out=5500, ao entrar outubro o cache continuava 5000 e o Perfil exibia um valor que já não valia. O Perfil agora resolve a competência atual via `GET /salary`; `User.salary` não é fonte de verdade para nenhuma decisão ou apresentação temporal.

O backfill da migration passou a derivar a competência de `CURRENT_TIMESTAMP AT TIME ZONE 'America/Fortaleza'` em vez de uma data fixa. Uma data fixa era determinística mas passaria a mentir se o deploy escorregasse — gravaria o salário de outubro como se valesse desde agosto.

## Renda mensal com histórico — `SalaryHistory` (Fase 9A) ✅

### O problema

`User.salary` guardava só o valor ATUAL, e o Orçamento o usava para calcular **qualquer** mês. Registrar um aumento em agosto reescrevia a sobra e o percentual comprometido de janeiro — um mês encerrado mudava sozinho, sem nenhum fato novo sobre ele.

### Modelo

`SalaryHistory` com competência **inteira** (`month` + `year`), seguindo o precedente de `Invoice`. Guardar `DateTime` exigiria normalizar o dia em toda escrita e comparação, com risco de virada de fuso em cada ponto (o app é America/Fortaleza, UTC-3).

Cada linha é uma **alteração** que vale a partir da competência e segue valendo até a próxima — o usuário não recadastra o mesmo valor todo mês.

- `@@unique([userId, year, month])` — uma competência, um valor; é o que torna o upsert idempotente
- **Não** representa receita real (`Transaction` INCOME). É referência de planejamento; alterar a renda não gera lançamento

### Resolver

`common/helpers/salary.helper.ts` → `resolveSalaryForMonth` é a fonte única. A query é `year < pedido OR (year = pedido AND month <= pedido)`: um `month <= 8` solto pegaria agosto de qualquer ano.

| Situação | Resultado |
|---|---|
| Nenhuma entrada | `known: false`, `amount: null` |
| Mês da entrada | resolve o valor |
| Mês posterior | carry-forward (inclusive atravessando o ano) |
| Mês ANTERIOR à primeira entrada | `known: false` |
| `amount: 0` | `known: true`, `amount: 0` |

**`known: false` ≠ `amount: 0`.** Zero é renda legítima (alguém entre empregos); desconhecido é ausência de informação. A tela diz "Renda não registrada para <mês>" em vez de "R$ 0,00", que afirmaria um fato falso.

### Backfill conservador

A migration cria baseline em **ago/2026** (data FIXA, não `CURRENT_DATE`) para quem tem `User.salary` não-nulo. Sabemos o valor atual, **não desde quando ele vale** — afirmar que valia "desde a criação da conta" inventaria fatos, e quem teve aumento em maio veria a renda nova aplicada a março. Meses anteriores resolvem como desconhecidos.

`CURRENT_DATE` foi evitado de propósito: aplicar em 31/08 às 23h de Fortaleza gravaria setembro (UTC já virou), deixando agosto sem baseline. O id usa `md5(...)::uuid` em vez de `gen_random_uuid()`, que é built-in só do Postgres 13 em diante.

### Papel de `User.salary`

Cache de leitura da renda de HOJE, para telas sem mês (perfil, cabeçalhos). **Recalculado pelo resolver**, não copiado do valor gravado:

- alteração no mês corrente → sincroniza
- alteração retroativa → **não** toca (corrigir o passado não muda a renda de hoje)
- alteração futura → **não** antecipa (o perfil exibiria um valor que ainda não vale)

`salary` foi **removido de `UpdateUserDto`**: escrevê-lo direto gravava o cache sem criar a entrada correspondente, e o resolver passava a discordar do perfil. Removido em vez de ignorado — com `whitelist: true` o campo seria descartado em silêncio e um cliente antigo acharia que salvou.

### Contrato do Budget

`GET /budget` devolve `salary` (do período), `salaryKnown`, `salaryEffectiveFrom`, `remaining` e `committedPct`.

- **Renda desconhecida** → `remaining: null` e `committedPct: null`. Calcular `0 - totalToPay` afirmaria uma capacidade financeira que ninguém informou
- **Renda zero** → `remaining` existe (`0 - totalToPay`), `committedPct` é `null`: não há percentual de zero, e devolver 0% ou 100% seria aproximação inventada
- As **despesas continuam sendo calculadas** sem renda: não saber a renda não impede saber quanto se deve
- Nada mais mudou no Orçamento — a única variável desta fase é a origem da renda

### UX

- Orçamento: "Definir renda" quando desconhecida; o diálogo diz **"Válido a partir de <mês>. Meses anteriores não são alterados"**
- Perfil: o campo passou a se chamar **"Renda mensal"** e significa "a partir do mês atual"; o usuário não precisa entender o histórico para uma alteração simples
- Não existe tela de timeline salarial — o histórico existe para os cálculos, não para ser administrado
- Invalidação: `budget` inteiro (uma entrada muda a renda derivada de todos os meses seguintes) + `me` (o cache pode ter mudado)

## Consolidado de Pessoas (Fase 8B) ✅

### O consolidado é ALL-TIME

`GET /persons/:id/statement` filtrava dívidas e cobranças por `dueDate` dentro do mês do seletor e rotulava o resultado **"te deve no total"**. Uma dívida vencida em junho e ainda aberta desaparecia do extrato de agosto — e `POST /persons/:id/settle` recebia os mesmos limites, então "Quitar pendências" deixava as pendências antigas abertas enquanto o toast dizia "N itens quitados".

| Campo | Fórmula | Recorte |
|---|---|---|
| `receivablePending` | soma de TODOS os Receivables com `isPaid: false` | nenhum |
| `debtPending` | soma de TODAS as Debts com `isPaid: false` | nenhum |
| `netBalance` | `receivablePending - debtPending` | nenhum |
| `pending{Receivables,Debts}Count` | contagem das mesmas | nenhum |
| `history` | itens com `isPaid: true` | **`paidAt` no mês** |

- **O seletor de mês governa só o histórico.** Filtro por `paidAt`, não `dueDate`: uma dívida de junho paga em agosto pertence ao histórico de agosto
- Fonte central: `common/helpers/person-consolidated.ts` (`buildPersonSummary`) — o mesmo objeto alimenta drawer, PDF, WhatsApp e settle, que antes tinham quatro cálculos independentes
- `isFullySettled` olha as **contagens**, nunca `netBalance === 0`: R$ 500 dos dois lados dá saldo zero com duas obrigações abertas
- 4 queries paralelas, sem N+1

### Contrato do endpoint (Fase 8C)

`GET /persons/:id/statement` devolve os dois universos com **nomes distintos**. Os espelhos `totalDebts`, `totalReceivables`, `netBalance`, `debts` e `receivables` foram **removidos**: significavam "do mês" antes da Fase 8B e "all-time" depois — o mesmo nome, dois universos, sem como o consumidor saber qual estava rodando.

```
summary   → situação ATUAL, all-time (receivablePending, debtPending, netBalance, counts, isFullySettled)
pending   → { debts, receivables } — as pendências que o summary soma, all-time
period    → { appliedRange, scopedBy: 'paidAt', settledDebts, settledReceivables,
              settledDebtTotal, settledReceivableTotal }
```

- `period.appliedRange` devolve o recorte que valeu (`null` quando não houve filtro) — sem ele o consumidor não distingue "nada quitado em agosto" de "nenhum filtro enviado"
- `period.scopedBy` é `paidAt`, **nunca `dueDate`**: uma dívida vencida em maio e paga em agosto pertence ao histórico de agosto
- A remoção dos espelhos é deliberadamente uma **quebra de tipo** no frontend: quem tentar ler um deles falha no typecheck em vez de receber o número do outro universo
- Endpoint **interno** (um único frontend, sem integração externa documentada) — por isso a limpeza foi feita sem período de depreciação

### Orçamento e Visão Geral são independentes

Auditados na Fase 8C: **nenhum dos dois consome `PersonStatement`**, então a Fase 8B não os alterou.

| Superfície | Fonte | Recorte |
|---|---|---|
| Orçamento | `debt`/`receivable` direto no Prisma | `dueDate` dentro do mês |
| Overview — "Atenção agora" | `GET /debts`, `GET /receivables` (sem filtro) | janela móvel de 7 dias, **inclui atraso anterior** |
| Overview — Calendário | as mesmas listas, já carregadas | mês exibido, no cliente |
| Overview — Gastos por categoria | `GET /transactions` | mês do seletor |
| Person drawer / settle / WhatsApp | `summary` / `pending` | all-time |
| Person histórico / PDF (seção período) | `period` | `paidAt` no mês |

- `GET /debts` e `GET /receivables` **sem parâmetros devolvem tudo** — a Visão Geral depende disso, porque seus widgets têm recortes diferentes entre si. Se esses endpoints passassem a recortar por mês, o painel de atenção perderia em silêncio os itens em atraso, que são a informação mais urgente da tela
- `budget-temporality.spec.ts` e `debts-query-scope.spec.ts` fixam esses contratos com duplos que **honram o filtro de data**, para falhar se o `where` for removido — e não apenas se a aritmética mudar

### "Quitar pendências"

- Marca individualmente **todas** as pendências abertas — reconsultadas dentro do `$transaction`, sem `startDate`/`endDate` (removidos do `SettlePersonDto`)
- **Não** existe compensação: R$ 800 a receber e R$ 300 a pagar geram 4 lançamentos pelos valores íntegros, nunca um de R$ 500
- **Atômico** (all-or-nothing): falha no meio não deixa item quitado. Diferente da geração de Subscription, onde granularidade parcial é desejada
- **Idempotente** pelo estado: o `isPaid: false` da reconsulta faz o retry encontrar conjunto vazio
- Respeita `createExpenseOnDebtPaid` / `createIncomeOnReceivablePaid`; o diálogo só promete lançamento quando a preferência realmente vai gerar um
- Cobrança automática é **recebida normalmente** — a proteção da Fase 8A é contra editar/excluir a compra de origem, não contra receber
- Rótulo do botão: **"Quitar pendências"** (era "Quitar tudo"). Disponível sempre que houver pendência, inclusive com saldo zero

### Núcleo compartilhado de quitação

`common/helpers/settlement.core.ts` — `PersonsService.settle` reimplementava ~110 linhas de `DebtsService.update`/`ReceivablesService.update` e **não chamava nenhuma guarda da Fase 8A**. As duas cópias já haviam divergido:

- **`paidAt`**: `DebtsService.update` ignorava `dto.paymentDate` e usava `new Date()`. O campo **não existia** em `UpdateDebtDto`, então o `ValidationPipe` (`whitelist: true`) descartava em silêncio a data que o `MarkAsPaidDialog` coletava — e o frontend nem a tipava. Corrigido nos três níveis; a mesma data vai para `paidAt` e para a transação
- `createDebtPaymentTransaction` / `createReceivablePaymentTransaction` / `removeSettlementTransaction` são a fonte única de categoria, banco, fatura e vínculo

### WhatsApp e PDF

- `lib/person-statement.ts` é a fonte única de texto. `balanceDirection` tem **quatro** estados: `receive`, `pay`, `settled` e **`offset`** (saldo zero com pendências)
- A mensagem dizia **"Estamos quites nesse período — nada pendente!"** com saldo zero — falso com R$ 500 pendentes de cada lado. Agora só `settled` autoriza linguagem de quitação
- Nunca reduz a relação ao líquido: expõe a composição, porque "você me deve R$ 300" afirmaria um encontro de contas que o app não fez
- Saldo negativo não usa linguagem de cobrança — o usuário é quem deve
- **Telefone**: `normalizeWhatsAppPhone` devolve `null` para número inválido e o link não é aberto. O prefixo é decidido pelo **comprimento** (10-11 dígitos = nacional; 12-13 = já com `55`), não por `startsWith('55')` — o **DDD 55 existe** (Santa Maria/RS), e a versão anterior rejeitava `(55) 99999-9999`, um número válido
- PDF imprime **"SITUAÇÃO ATUAL"** com a composição (A receber / A pagar / nº de pendências) e uma seção separada `QUITADO — <período>`. Antes mostrava só o saldo num card grande, sem composição, com label dizendo "no total". Recebe o `summary` pronto — não recalcula

### Deep link "Ver a compra"

- `?highlight=<transactionId>` no Extrato (`lib/use-highlight.ts`): posiciona o mês pela data, rola até a linha e aplica destaque **temporário** (2,6s) — permanente seria lido como status do lançamento
- Grupo de parcelas **abre expandido** quando o alvo está escondido, via `parentId ?? id` (metadado estrutural, não a regex de título)
- Apenas navegação: a query segue filtrada por ownership; id inexistente não destaca nada e não quebra a página

### Delete e rename de Person

- FK `personId` é `ON DELETE SET NULL` em Debt, Receivable e Transaction; `creditorName`/`debtorName` guardam o nome na criação → os registros **sobrevivem e continuam legíveis**
- Por isso a exclusão é permitida **mesmo com pendências**: encerra o cadastro do contato, não os compromissos. A cópia do diálogo diz exatamente isso
- Rename **não** propaga para os snapshots — seria reescrever histórico textual. O cabeçalho do drawer usa o nome atual

### Estados e UX

- Drawer e lista distinguem `loading` / `error` / `success-empty` / `success-data`, com `role="alert"` e retry. Antes, API fora do ar exibia "Nenhuma pessoa cadastrada"
- Pendências ordenadas por vencimento (em atraso primeiro); histórico por `paidAt` desc
- Cobrança automática recebe badge discreto "Compra no cartão" e a linha linka para a compra
- `PersonFormSheet`: `sm:max-w-md` + `overflow-y-auto` no form + footer `shrink-0` — sem isso o botão de salvar saía da tela em notebook

## Ciclo de faturamento do banco — `PATCH /banks/:id` (✅ Implementado)

### Datas de fatura são snapshots, não funções do banco

`Invoice.closeDate` e `Invoice.dueDate` são **persistidos na criação**. Antes eram
derivados da configuração ATUAL do banco a cada leitura, então mudar o vencimento
do cartão reescrevia as datas de todo o histórico — uma fatura paga em agosto
passava a exibir outro vencimento.

Por isso a pergunta não é "por que não recalcula tudo?": recalcular o histórico é
que seria a regressão.

### O que a alteração do ciclo atinge

Só faturas **`OPEN`**. Não é conveniência: um parcelamento em 10x materializa
faturas futuras de imediato, e sem isso uma troca de cartão levaria meses para
surtir efeito nas faturas já criadas.

| Situação | Efeito | Motivo registrado no plano |
|---|---|---|
| `OPEN` e ainda aberta pelo calendário | `closeDate`, `dueDate` e `status` atualizados | — |
| `CLOSED` / `OVERDUE` / `PAID` | intactas | `HISTORICAL_STATUS` |
| `OPEN` que o calendário já fechou | intacta | `EFFECTIVELY_CLOSED` |
| Datas que não se movem de fato | intacta | `NO_DATE_CHANGE` |

`NO_DATE_CHANGE` existe pelo clamp: dias 30 e 31 colapsam no mesmo dia em
fevereiro, e sem alteração real a fatura não entra na contagem que a interface
mostra.

### Transações não são redistribuídas

`month`/`year`, `invoiceId` e `totalAmount` ficam intactos — só as **datas** da
fatura mudam. Redistribuir lançamentos reescreveria histórico em cascata: uma
compra que sempre pertenceu à fatura de outubro passaria para novembro sem que
ninguém tivesse pedido.

### Detalhes

- `billing-config-plan.helper.ts` é **puro**, e é a mesma função usada pela prévia
  (`POST /banks/:id/preview-billing-config`) e pelo save — o padrão que resolveu a
  divergência entre preview e update em Transactions
- Banco, faturas e recebíveis mudam num **único `$transaction`**: ou muda tudo, ou
  nada muda
- O `status` é derivado **inline** (`deriveStatusFromInvoiceDates`), não delegado
  ao cron. Esperar a madrugada deixaria uma fatura cujo novo fechamento já passou
  marcada como aberta. `AppScheduler.syncInvoiceStatus` continua sendo o único
  outro call site, para a passagem natural do tempo
- Recebíveis automáticos **pendentes** das faturas afetadas acompanham o novo
  `dueDate`; os já recebidos ficam intactos
- Frontend invalida `banks`, `invoices`, `bank-invoices` e `receivables`

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

### Renda temporal ✅ (Fase 9A)
Ver seção "Renda mensal com histórico" abaixo.
