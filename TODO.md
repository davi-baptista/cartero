# Cartero - TODO

## Backend ⏳ Pendente

- [ ] `GET /statement` — combina: transactions + debts + receivables pagos
- [ ] `GET /alerts` — faturas com due_date = hoje e status != PAID; dívidas com due_date = hoje, isAlertEnabled e isPaid = false
- [ ] `PATCH /banks/:id` — ao alterar `invoiceCloseDate` ou `invoiceDueDate`, recalcular status das faturas do banco (OPEN→CLOSED se close_date já passou, CLOSED→OVERDUE se due_date já passou). **Não re-atribuir transações** — mudança de data só afeta faturas futuras.
- [ ] `PATCH /transactions/:id` — ao alterar `date` de transação CREDIT_CARD, re-atribuir invoice via `findOrCreateInvoice` e recalcular `totalAmount` das faturas afetadas. **Guard:** bloquear se invoice original for CLOSED ou PAID. Parcelamentos: scope=ONE/NEXT/ALL já cobre, cada parcela roda `findOrCreateInvoice` com sua própria data.

## Frontend ⏳ Pendente

- [ ] `GET /alerts` → banner/modal de alertas ao abrir o app
- [ ] `GET /statement` → página de extrato geral
