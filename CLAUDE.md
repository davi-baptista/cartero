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
- `type` (enum: INCOME, CREDIT_CARD, DEBIT_CARD, PIX, BOLETO, PAYMENT_OF_DEBT)
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
- `PAYMENT_OF_DEBT` — gerado automaticamente ao quitar uma dívida externa (módulo Debts). Nunca criado diretamente pelo usuário.

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
- `due_date` (date, opcional)
- `is_alert_enabled` (boolean, default: true)
- `is_paid` (boolean, default: false)
- `paid_at` (timestamp, opcional)
- `transaction_id` (UUID, FK, opcional - transação PAYMENT_OF_DEBT gerada ao quitar a dívida, null se pago em dinheiro)
- `parent_id` (UUID, opcional - vincula parcelas de uma dívida parcelada)
- `created_at` (timestamp)
- `updated_at` (timestamp)

**Comportamento:**

- Aparece em aba separada (não mistura com transações normais)
- Só aparece no extrato geral quando `is_paid = true`, perguntando a forma de pagamento
- Alertas aparecem ao abrir o app enquanto não pago (apenas no dia do vencimento se `is_alert_enabled = true`)
- **Parcelamento:** Cada parcela = 1 transação separada. O frontend exibe `title` como "Nome x/y" (ex: "Empréstimo notebook 2/6"). Ao criar dívida parcelada, gera N transações de uma vez (igual às transações normais)
- **Deleção de parcelas:** Quando o usuário tenta deletar uma parcela, o sistema pergunta o que fazer (igual às transações)

#### A Receber (Receivables)

- `id` (UUID, PK)
- `user_id` (UUID, FK)
- `debtor_name` (string, obrigatório - nome de quem deve)
- `title` (string, obrigatório - texto principal exibido na UI, ex: "Venda parcelada 1/3")
- `amount` (decimal, obrigatório)
- `description` (string, opcional)
- `due_date` (date, opcional)
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
│   │   │   ├── categories/
│   │   │   ├── transactions/
│   │   │   ├── invoices/
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

## Decisões Recentes

- `title` é o texto principal exibido na UI para `transactions`, `debts` e `receivables`. `description` continua sendo um campo secundário/opcional.
- Foi criado um `CommonModule` no backend para concentrar código compartilhado.
- Foi criado um `EntityValidationService` em `src/common` para reduzir repetição de validações como banco, categoria e transação.
- A intenção é manter os services de domínio menores, empurrando validações compartilhadas para `common` quando fizer sentido.
- O `create` de `transactions` está sendo evoluído para suportar parcelamento real no backend.

## Regras de Negócio Importantes

1. **Faturas são geradas automaticamente** quando há transações de crédito associadas a um banco
2. **Lógica de fechamento de fatura:**
   - Regra atual adotada no projeto: a fatura é identificada pelo mês de fechamento.
   - Transação com `date >= invoice_close_date` → vai para a fatura do mês da própria transação
   - Transação com `date < invoice_close_date` → vai para a fatura do mês anterior
   - Exemplo: fechamento dia 15. Transação em `2026-02-15` vai para a fatura de fevereiro. Transação em `2026-02-14` vai para a fatura de janeiro.
   - Atenção para virada de ano: uma transação em janeiro antes do fechamento pode pertencer à fatura de dezembro do ano anterior.
   - Em parcelamento de cartão, cada parcela precisa recalcular sua própria fatura com base na data daquela parcela.
3. **Status da fatura:** Quatro estados: `OPEN` → `CLOSED` → `OVERDUE` → `PAID`. O cron job diário gerencia as transições automáticas (OPEN→CLOSED no close_date, CLOSED→OVERDUE no due_date). O usuário muda para `PAID` manualmente.
4. **Não há gestão de saldo dos bancos**, apenas gastos
5. **Alertas persistem até ação do usuário** (marcar como pago)
6. **Dívidas externas:**
   - Se `bank_id = null` ao marcar pago → pago em dinheiro, não gera transação
   - Se `bank_id` preenchido ao marcar pago → gera transação `PAYMENT_OF_DEBT` no banco (requer `category_id` também)
   - Dívidas pagas sem `bank_id` ainda aparecem no extrato geral (ver regra 9)
7. **Dívidas externas só aparecem no extrato quando pagas**
8. **Receivables:** ao marcar como recebido → apenas seta `isPaid = true` / `paidAt`. Não gera transação. Não precisa de `bank_id`. Recebimentos aparecem num extrato geral separado dos gastos por banco.
9. **Extrato Geral (`GET /statement`):** endpoint separado que combina duas fontes:
   - Todas as `transactions` do usuário (sempre têm `bank_id`)
   - `debts` com `isPaid = true` e `transactionId = null` (pagas em dinheiro, sem banco)
   - `receivables` com `isPaid = true`
   - `bankId` em `Transaction` permanece obrigatório — não existe transação sem banco no schema.
8. **Limitações atuais:**
   - ~~Alertas só aparecem quando usuário abre o app (sem push/email)~~ - AGORA TEM CRON JOBS
   - ~~Status de fatura (fechada/vencida) só atualiza quando usuário entra no app~~ - AGORA TEM CRON JOBS

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

## Deployment (Gratuito)

- **Backend:** Railway (tem plano gratuito com PostgreSQL)
- **Frontend:** Vercel
- **Docker:** Opcional para desenvolvimento local

## Estado Atual do Projeto

### Backend (Nest.js)

- ✅ Estrutura base criada
- ✅ Prisma configurado
- ✅ Schema com models principais criado
- ✅ Auth, Users, Banks, Categories, Transactions e Invoices já possuem estrutura inicial
- ✅ `CommonModule` e `EntityValidationService` já criados
- ⚠️ `Transactions` está em evolução, especialmente o fluxo de parcelamento

### Frontend (Next.js)

- ❌ Pasta vazia
- ❌ Precisa ser inicializado

### TODO (atualizado do TODO.md original)

- [ ] Setup: NestJS + Next.js + Docker + PostgreSQL
- [ ] Backend: Auth (JWT)
- [ ] Backend: Users + Banks + Categories
- [ ] Backend: Transactions
- [ ] Backend: Credit Invoices (geração automática)
- [ ] Backend: Debts + Receivables
- [ ] Backend: Alerts (avisos ao acessar)
- [ ] Frontend: Setup + shadcn/ui + tema dark
- [ ] Frontend: Auth (login/registro)
- [ ] Frontend: Dashboard + páginas
- [ ] Deploy: Railway + Vercel

## Notas

- A qualquer momento, este documento pode ser atualizado para refletir mudanças no escopo ou decisões de design.
- Sempre que modificar algo significativo no schema ou funcionalidades, atualizar este documento.
