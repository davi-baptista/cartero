# Cartero - Sistema de Gestão Financeira Pessoal

## Visão Geral

Web app de gestão financeira pessoal, com potencial para se tornar um serviço multi-usuário no futuro (hospedagem gratuita: Railway + Vercel).

## Stack Tecnológica

- **Backend:** Nest.js (Node.js)
- **Frontend:** Next.js + React
- **Banco de Dados:** PostgreSQL + Docker
- **UI:** shadcn/ui (tema dark, estilo: https://shadcnblocks-admin.vercel.app/)

## Funcionalidades Principais

### 1. CRUD de Entidades Base

#### Usuário

- `id` (UUID, PK)
- `email` (string, único)
- `password` (string, hash bcrypt)
- `name` (string, obrigatório)
- `salary` (decimal, opcional - salário do usuário para referência pessoal)
- `created_at` (timestamp)
- `updated_at` (timestamp)

#### Banco

- `id` (UUID, PK)
- `user_id` (UUID, FK)
- `name` (string, obrigatório)
- `invoice_close_date` (int, dia do mês: 1-31)
- `invoice_due_date` (int, dia do mês: 1-31)
- `created_at` (timestamp)
- `updated_at` (timestamp)

#### Categoria

- `id` (UUID, PK)
- `user_id` (UUID, FK)
- `name` (string, obrigatório)
- `color` (string, opcional - cor hex para visualização)
- `icon` (string, opcional - emoji selecionado pelo usuário no frontend)
- `created_at` (timestamp)
- `updated_at` (timestamp)

#### Transação

- `id` (UUID, PK)
- `user_id` (UUID, FK)
- `bank_id` (UUID, FK, obrigatório)
- `category_id` (UUID, FK, obrigatório)
- `invoice_id` (UUID, FK, opcional - marca a qual fatura pertence)
- `parent_id` (UUID, opcional - vincula parcelas de uma compra parcelada)
- `type` (enum: INCOME, CREDIT_CARD, DEBIT_CARD, PIX, BOLETO)
- `title` (string, obrigatório - texto principal exibido na UI, ex: "Celular 3/10")
- `amount` (decimal, obrigatório)
- `description` (string, opcional)
- `date` (date, obrigatório)
- `created_at` (timestamp)
- `updated_at` (timestamp)

**Tipos de transação:**
- `INCOME` — receita (entrada de dinheiro)
- `CREDIT_CARD` — compra no crédito (vai para fatura do banco)
- `DEBIT_CARD` — compra no débito
- `PIX` — pagamento via PIX
- `BOLETO` — pagamento de boleto

**Parcelamento:** Em `transactions`, parcelamento só existe para `type = CREDIT_CARD`. Cada parcela = 1 transação separada. O frontend exibe `title` como "Nome x/y" (ex: "Celular 3/10"). Ao criar transação parcelada, o sistema gera N transações de uma vez. As parcelas são vinculadas por `parent_id` (UUID da primeira transação - todas as parcelas apontam para o ID da primeira).

**Deleção de parcelas:** Quando o usuário tenta deletar uma parcela, o sistema pergunta:

- "Deletar apenas esta parcela" → deleta só a atual
- "Deletar esta e futuras" → deleta esta + todas as parcelas com data >= atual
- "Deletar todas as parcelas" → deleta todas (passadas + futuras)
- "Cancelar" → fecha o modal

#### Fatura (Invoice)

- `id` (UUID, PK)
- `user_id` (UUID, FK)
- `bank_id` (UUID, FK)
- `month` (int, 1-12)
- `year` (int)
- `status` (enum: OPEN, CLOSED, PAID, OVERDUE)
- `total_amount` (decimal, calculado - soma das transações de crédito)
- `created_at` (timestamp)
- `updated_at` (timestamp)

**Nota sobre datas:** As datas de fechamento e vencimento são calculadas em runtime baseado no banco:

- `close_date`: date(bank.invoice_close_date, month, year)
- `due_date`: date(bank.invoice_due_date, month, year)

Para faturas CLOSED/PAID, essas datas são "congeladas" para manter consistência histórica.

### 2. Abas Diferenciais

#### Dívidas Externas (Debts)

- `id` (UUID, PK)
- `user_id` (UUID, FK)
- `creditor_name` (string, obrigatório - nome de quem deve)
- `title` (string, obrigatório - texto principal exibido na UI, ex: "Empréstimo notebook 2/6")
- `amount` (decimal, obrigatório)
- `description` (string, opcional)
- `due_date` (date, obrigatório)
- `is_alert_enabled` (boolean, default: true)
- `is_paid` (boolean, default: false)
- `paid_at` (timestamp, opcional)
- `parent_id` (UUID, opcional - vincula parcelas de uma dívida parcelada)
- `created_at` (timestamp)
- `updated_at` (timestamp)

**Comportamento:**

- Aparece em aba separada (não mistura com transações normais)
- Só aparece no extrato geral quando `is_paid = true`
- Alertas aparecem ao abrir o app enquanto não pago (apenas no dia do vencimento se `is_alert_enabled = true`)
- **Parcelamento:** Cada parcela = 1 registro separado. O frontend exibe `title` como "Nome x/y" (ex: "Empréstimo notebook 2/6"). Ao criar dívida parcelada, gera N registros de uma vez (igual às transações normais)
- **Deleção de parcelas:** Quando o usuário tenta deletar uma parcela, o sistema pergunta o que fazer (igual às transações)

#### A Receber (Receivables)

- `id` (UUID, PK)
- `user_id` (UUID, FK)
- `debtor_name` (string, obrigatório - nome de quem deve)
- `title` (string, obrigatório - texto principal exibido na UI, ex: "Venda parcelada 1/3")
- `amount` (decimal, obrigatório)
- `description` (string, opcional)
- `due_date` (date, obrigatório)
- `is_paid` (boolean, default: false)
- `paid_at` (timestamp, opcional)
- `parent_id` (UUID, opcional - vincula parcelas de um receivable parcelado)
- `created_at` (timestamp)
- `updated_at` (timestamp)

**Comportamento:**

- Aba separada para lembrar o que têm para receber
- Sem alertas automáticos (apenas visualização)
- Ao marcar como recebido → apenas seta `isPaid = true` e `paidAt`. **Não gera transação**, pois o foco do app é gestão de gastos. Recebimentos aparecem num extrato geral, sem vínculo a banco.
- **Parcelamento:** Cada parcela = 1 registro separado. O frontend exibe `title` como "Nome x/y" (ex: "Venda parcelada 1/3"). Ao criar receivable parcelado, gera N registros de uma vez (igual às transações)
- **Deleção de parcelas:** Quando o usuário tenta deletar uma parcela, o sistema pergunta o que fazer (igual às transações)

### 3. Sistema de Alertas

#### Lógica de Alertas (ao abrir o app)

1. **Faturas vencidas:** Buscar faturas com `due_date = hoje` e `status != PAID`
2. **Dívidas externas:** Buscar dívidas com `due_date = hoje`, `is_alert_enabled = true` e `is_paid = false`

### 4. Autenticação

- JWT (access token + refresh token)
- Registro/Login
- Cada usuário vê apenas seus próprios dados

## Estrutura de Pastas Sugerida

```
cartero-backend/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── jwt.strategy.ts
│   │   └── dto/
│   ├── users/
│   ├── banks/
│   ├── categories/
│   ├── transactions/
│   ├── invoices/
│   ├── debts/
│   ├── receivables/
│   ├── alerts/
│   └── common/
│       ├── guards/
│       ├── decorators/
│       └── filters/

cartero-frontend/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/
│   │   │   └── register/
│   │   ├── (dashboard)/
│   │   │   ├── banks/
│   │   │   │   └── [id]/
│   │   │   │       └── invoices/
│   │   │   ├── categories/
│   │   │   ├── transactions/
│   │   │   ├── debts/
│   │   │   ├── receivables/
│   │   │   └── layout.tsx
│   │   ├── api/
│   │   └── page.tsx
│   ├── components/
│   │   ├── ui/ (shadcn components)
│   │   └── shared/
│   ├── hooks/
│   ├── lib/
│   └── types/
```

## Regras de Negócio Importantes

1. **Faturas são geradas automaticamente** quando há transações de crédito associadas a um banco
2. **Lógica de fechamento de fatura:**
   - Regra atual adotada no projeto: a fatura é identificada pelo mês de fechamento.
   - Transação com `date > invoice_close_date` → vai para a fatura do mês seguinte (próximo ciclo)
   - Transação com `date <= invoice_close_date` → vai para a fatura do mês da própria transação
   - Transação com `date < invoice_close_date` e no primeiro dia do mês → pode pertencer ao mês anterior
   - Exemplo: fechamento dia 15. Transação em `2026-02-15` vai para a fatura de fevereiro. Transação em `2026-02-16` vai para a fatura de março. Transação em `2026-02-14` vai para a fatura de janeiro.
   - Atenção para virada de ano: uma transação em janeiro antes do fechamento pode pertencer à fatura de dezembro do ano anterior.
   - Em parcelamento de cartão, cada parcela precisa recalcular sua própria fatura com base na data daquela parcela.
3. **Status da fatura:** Quatro estados: `OPEN` → `CLOSED` → `OVERDUE` → `PAID`. O cron job diário gerencia as transições automáticas (OPEN→CLOSED no close_date, CLOSED→OVERDUE no due_date). O usuário muda para `PAID` manualmente.
4. **Não há gestão de saldo dos bancos**, apenas gastos
5. **Alertas persistem até ação do usuário** (marcar como pago)
6. **Dívidas externas:** marcar como paga → seta `isPaid = true` e `paidAt`. Reverter → limpa `paidAt = null`. Não gera transação. Só aparecem no extrato geral quando pagas.
7. **Receivables:** marcar como recebido → seta `isPaid = true` e `paidAt`. Reverter → limpa `paidAt = null`. Não gera transação. Não precisa de `bank_id`.
8. **Extrato Geral (`GET /statement`):** endpoint pendente que combinará: todas as `transactions` + `debts` com `isPaid = true` + `receivables` com `isPaid = true`.

## Sistema de Cron Jobs (Atualização Automática)

**Objetivo:** Manter faturas e alertas atualizados mesmo quando o usuário não acessa o app, permitindo notificações futuras.

### Cron Job: Fechamento de Faturas

- **Frequência:** Diária (meia-noite ou mais frequentemente)
- **Lógica:** Para cada fatura com `status = OPEN`:
  - Se `data_atual >= close_date` → mudar para `CLOSED`
- **close_date** = data calculada: `date(bank.invoice_close_date, month, year)`

### Cron Job: Vencimento de Faturas

- **Frequência:** Diária
- **Lógica:** Para cada fatura com `status = CLOSED`:
  - Se `data_atual >= due_date` → mudar para `OVERDUE`
- **due_date** = data calculada: `date(bank.invoice_due_date, month, year)`

### Benefícios

1. Status sempre atualizado → notificações funcionam
2. Histórico consistente (datas congeladas em CLOSED/PAID)
3. Suporte a notificações push/email futuras

## Melhorias Futuras (Produção)

- **Refresh token stateful:** Guardar refresh tokens no banco (`refresh_tokens` table com hash do token + userId + expiresAt). Ao usar o refresh → deletar o antigo e criar novo par (rotação). Logout real apagando do banco. Refresh token em HttpOnly cookie para proteção contra XSS.

## Deployment (Gratuito)

- **Backend:** Railway (tem plano gratuito com PostgreSQL)
- **Frontend:** Vercel
- **Docker:** Opcional para desenvolvimento local

## Estado Atual do Projeto

### Backend (Nest.js)

- ✅ Estrutura base criada
- ✅ Prisma configurado
- ✅ Schema com models principais criado
- ✅ Auth, Users, Banks, Categories, Transactions, Invoices, Debts e Receivables completos
- ✅ `CommonModule` e `EntityValidationService` criados
- ✅ Parcelamento implementado em Transactions, Debts e Receivables
- ✅ Filtros implementados em `GET /transactions`
- ✅ `GET /invoices/:id` retorna invoice com transactions incluídas
- ✅ `findOrCreateInvoice` corrigido: fórmula do mês (`((month + 1) % 12) + 1`) e status dinâmico (OPEN/CLOSED/OVERDUE) baseado na data atual vs close_date e due_date
- ⏳ Alerts (`GET /alerts`) pendente
- ⏳ Statement (`GET /statement`) pendente

### Frontend (Next.js)

- ✅ Setup (Next.js + shadcn/ui + tema dark)
- ✅ Auth (login/registro)
- ✅ Dashboard com sidebar colapsável
- ✅ Bancos (`/banks`)
- ✅ Categorias (`/categories`)
- ✅ Transações (`/transactions`) com filtros
- ✅ Faturas (`/banks/:id/invoices`) com sheet de detalhes colorido por status
- ✅ Dívidas (`/debts`)
- ✅ A Receber (`/receivables`)

### Próximos passos

- [ ] Backend: Alerts (`GET /alerts`)
- [ ] Backend: Statement (`GET /statement`)
- [ ] Deploy: Railway + Vercel

## Frontend: Design e Visual

### Princípios

- **Tema:** dark obrigatório, sem toggle light/dark
- **Biblioteca:** shadcn/ui — usar os componentes nativos sem customizações desnecessárias
- **Referência visual:** https://shadcnblocks-admin.vercel.app/
- **Tom:** moderno, elegante, minimalista — mas com densidade de informação adequada (sem telas vazias)

### Diretrizes visuais

- **Tipografia:** hierarquia clara — valor monetário em destaque (tamanho maior), título em peso normal, metadata (data, categoria) em `text-muted-foreground` menor
- **Valores monetários:** sempre formatados como moeda (`R$ 1.234,56`), negativos em vermelho (`text-destructive`), positivos em verde (`text-green-500` ou similar)
- **Cores de categoria e banco:** usar o campo `color` do modelo para pintar badges, ícones ou bordas laterais nos cards/linhas
- **Status de fatura:** badges coloridos — `OPEN` (azul), `CLOSED` (amarelo), `OVERDUE` (vermelho), `PAID` (verde)
- **Espaçamento:** generoso entre seções, compacto dentro de listas — evitar padding excessivo que deixa a tela vazia
- **Separadores:** usar `border-b` sutil entre linhas de lista em vez de cards individuais para cada item (mais limpo)
- **Ações:** botões de ação (editar, deletar) aparecem no hover da linha/card — não poluir a UI com ícones sempre visíveis
- **Formulários:** usar Sheet (painel lateral) ou Dialog para criar/editar — não navegar para outra página
- **Feedback:** toasts para confirmação de ações (criado, editado, deletado, erro)
- **Loading:** skeleton nos lugares certos, não spinner global

### Componentes-chave esperados

- `TransactionRow` — linha de transação com ícone da categoria, título, banco, valor e data
- `DebtCard` / `ReceivableCard` — card compacto com status de pagamento e vencimento destacado
- `InvoiceStatusBadge` — badge de status com cor correspondente
- `AmountDisplay` — componente de valor formatado com cor automática (positivo/negativo)
- `InstallmentScopeModal` — modal de confirmação ao editar/deletar parcelas com as 3 opções de scope
- `FilterBar` — barra de filtros da página de transações (data, banco, categoria, tipo)

## Frontend: Páginas e Rotas

### Autenticação

| Página | Rota frontend | Endpoints usados |
|---|---|---|
| Login | `/login` | `POST /auth/login` |
| Registro | `/register` | `POST /auth/register` |

### Dashboard

| Página | Rota frontend | Endpoints usados |
|---|---|---|
| Bancos | `/banks` | `GET /banks`, `POST /banks`, `PATCH /banks/:id`, `DELETE /banks/:id` |
| Categorias | `/categories` | `GET /categories`, `POST /categories`, `PATCH /categories/:id`, `DELETE /categories/:id` |
| Transações | `/transactions` | `GET /transactions`, `POST /transactions`, `PATCH /transactions/:id`, `DELETE /transactions/:id` |
| Faturas | `/banks/:id/invoices` | `GET /banks/:id/invoices`, `GET /invoices/:id`, `PATCH /invoices/:id` |
| Dívidas | `/debts` | `GET /debts`, `POST /debts`, `PATCH /debts/:id`, `DELETE /debts/:id` |
| A Receber | `/receivables` | `GET /receivables`, `POST /receivables`, `PATCH /receivables/:id`, `DELETE /receivables/:id` |

### Rotas com filtros

**`GET /transactions`** — todos os parâmetros são opcionais via query string:
- `startDate` — data início (ISO string, ex: `2026-05-01`)
- `endDate` — data fim (ISO string, ex: `2026-05-31`)
- `bankId` — UUID do banco
- `categoryId` — UUID da categoria
- `type` — tipo da transação (`INCOME`, `CREDIT_CARD`, `DEBIT_CARD`, `PIX`, `BOLETO`)

Exemplo: `GET /transactions?startDate=2026-05-01&endDate=2026-05-31&type=CREDIT_CARD`

### Parâmetro `scope` (parcelas)

`PATCH` e `DELETE` de `transactions`, `debts` e `receivables` aceitam `?scope=` via query string:

- `ONE` (padrão) — afeta apenas o registro atual
- `NEXT` — afeta o atual e todos os próximos (mesma série, data >=)
- `ALL` — afeta todos da mesma série (passados + futuros)

Exemplo: `DELETE /transactions/:id?scope=ALL`

O frontend deve exibir um modal de confirmação quando o registro tem `parentId`, perguntando ao usuário qual escopo deseja aplicar.

### Comportamento de faturas no frontend

- A página de faturas fica dentro de cada banco: `/banks/:id/invoices`
- Ao clicar numa fatura, abre detalhes com lista de transações (`GET /invoices/:id`)
- Ações disponíveis: mudar status para `PAID` via `PATCH /invoices/:id`
- Status `OPEN → CLOSED → OVERDUE` são gerenciados automaticamente pelo cron job

## Notas

- A qualquer momento, este documento pode ser atualizado para refletir mudanças no escopo ou decisões de design.
- Sempre que modificar algo significativo no schema ou funcionalidades, atualizar este documento.
