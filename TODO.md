# Cartero - TODO

## Backend ⏳ Pendente

- [ ] `GET /statement` — combina: transactions + debts + receivables pagos
- [ ] `GET /alerts` — faturas com due_date = hoje e status != PAID; dívidas com due_date = hoje, isAlertEnabled e isPaid = false

## Frontend ⏳ Pendente

- [ ] `GET /alerts` → banner/modal de alertas ao abrir o app
- [ ] `GET /statement` → página de extrato geral

## Orçamento — semântica final (decidida na Fase 9B)

As pendências abertas nas Fases 8C/9A foram resolvidas conscientemente.

1. **Dívida vencida em mês anterior — RESOLVIDO.** Agora aparece como
   `priorCarry` (seção "Pendências anteriores"), com o vencimento original
   preservado. A condição temporal usa `paidAt`, não `isPaid`, para que o
   orçamento de um mês passado seja um snapshot daquele mês.

2. **Dívida futura fora do mês atual — CORRETO POR DECISÃO DE PRODUTO**, não
   bug. O Orçamento é planejamento mensal: uma dívida de setembro entra quando
   setembro é selecionado. Trazê-la para agosto misturaria os meses e inflaria
   o comprometimento de um mês que ainda não chegou. Compromissos é a
   superfície para ver o futuro.

3. **Compensação Debt × Receivable — REMOVIDA.** Era
   `debt - min(receivable, debt)`, e o `.filter(amount > 0)` fazia uma pessoa
   totalmente compensada DESAPARECER da lista. Recebível é dinheiro esperado,
   não pagamento feito; ele agora aparece como informação e não abate nada.

4. **Divergência entre Budget e Pessoas — ESPERADA E DOCUMENTADA.** As duas
   telas respondem perguntas diferentes: o Orçamento é mensal
   ("quanto da minha renda está comprometido neste mês"), o extrato da pessoa
   é all-time ("como estamos hoje"). Nenhuma das duas está errada; o que era
   errado era o Orçamento afirmar um valor compensado.

5. **`SalaryHistory` — RESOLVIDO na Fase 9A**, com o rollover de cache
   corrigido na 9B: o Perfil resolve a competência atual em vez de ler
   `User.salary`, que ficava obsoleto na virada do mês sem nenhuma escrita.

## Calendário — revisado na Fase 9D ✅

Os seis achados da Fase 9C foram resolvidos ou decididos:

1. **Transactions ausentes — CORRIGIDO.** Movimentações diretas (débito, PIX,
   boleto, receita, estorno) agora aparecem na data da própria Transaction.
   `CREDIT_CARD` fica de fora de propósito: no calendário, crédito é
   representado pelo vencimento da fatura — incluir a compra também criaria dois
   eventos para o mesmo dinheiro.
2. **Valor bruto da fatura — CORRETO, agora explicado.** O evento continua
   valendo o bruto (é o que o banco cobra), com decomposição secundária
   "R$ 700 seus · R$ 300 de outras pessoas" quando há terceiros. Sem terceiros a
   linha é omitida.
3. **Overdue anterior ausente — COMPORTAMENTO CORRETO**, decidido nesta fase.
   Uma dívida vencida em junho pertence ao calendário de junho; movê-la para
   agosto mentiria sobre a data do fato. "Atenção agora" é quem garante a
   permanência visual do que está em atraso.
4. **`urgent` — era código morto.** O campo era calculado nos três tipos e
   nunca lido. Removido; a urgência agora vem do `status` derivado
   (`settlement-status.ts` / `invoice-status.ts`).
5. **`banks.find()` no laço — CORRIGIDO.** Substituído por um `Map` de nomes
   construído uma vez, junto com o breakdown de faturas.
6. **Recebível pendente verde — CORRIGIDO.** A cor passou a codificar a
   DIREÇÃO do dinheiro (`out` / `in` / `neutral`), não o tipo. Pendente usa
   `bg-pending`; verde ficou só para entrada concluída.

## Pendências abertas (após a auditoria final da Fase 10)

### Bloqueadores de deploy
Nenhum. As migrations foram ensaiadas em PostgreSQL 16 descartável (Docker),
tanto em banco vazio quanto em upgrade sobre dados legados, e `migrate diff`
confirmou zero drift em relação ao schema Prisma.

### Limitações aceitas (decisões conscientes, não bugs)
- **`TransactionType` mistura natureza e forma de pagamento.** A UI separa
  "Gasto/Receita" da forma e impede combinações inválidas; mudar o schema
  exigiria migração de todo o histórico.
- **`Bank` não distingue Conta de Cartão.** Um banco sem fatura funciona; o
  modelo apenas não formaliza a diferença.
- **Estorno de terceiro não é suportado** para novas operações
  (`REFUND_PERSON_NOT_SUPPORTED`). Legado é tratado defensivamente.
- **Estorno não tem vínculo estrutural com a compra original** — a redução é
  por categoria/período, não por transação.
- **`Bank` billing config não tem versionamento.** Alterar vencimento não
  reescreve faturas existentes (Fase 6B), mas também não guarda o histórico da
  configuração anterior.
- **Renda anterior à adoção de `SalaryHistory` é desconhecida**, não zero. A
  migration deliberadamente não inventa histórico.
- **Reparo automático de parcelas históricas não é seguro** e não é tentado.
- **Pagamento parcial não existe.** Um item é pago ou não.
- **Datas de faturas antigas** foram congeladas com a configuração vigente na
  adoção — o histórico real de configuração é irrecuperável.

### Melhorias futuras opcionais
- Testes de componente/E2E (hoje só lógica pura tem suíte).
- Validação visual de responsividade em dispositivos reais.
- 11 vulnerabilidades transitivas em devDependencies (3 moderate, 8 high), todas
  DoS em ferramentas de build/lint, sem alcance no bundle publicado. Corrigir
  exigiria major upgrades fora do escopo do congelamento.
