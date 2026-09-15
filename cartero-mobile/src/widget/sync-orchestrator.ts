import type { SnapshotSync } from './snapshot-sync'
import type { InvoicesSync } from './invoices-sync'

/**
 * Uma pequena authority para os syncs de snapshot do owner atual.
 *
 * Antes do M5B havia um único sync (Budget), chamado direto pelos triggers.
 * O M5B acrescenta Invoices, e sem esta authority o `session-provider.tsx`
 * cresceria como:
 *
 *   syncBudget()
 *   syncInvoices()
 *   futuro syncBalance()
 *   futuro syncPersons()
 *
 * — um trigger chamando cada sync individualmente, com o mesmo risco de
 * esquecer um novo widget num dos três lifecycle events. `syncWidgetSnapshots`
 * é o único ponto que os triggers conhecem; snapshots novos entram nesta
 * lista, não em mais um `useEffect`.
 *
 * ── Isolamento de falha ──
 *
 * `Promise.allSettled`, não `Promise.all`: um 502 em Invoices não pode
 * impedir que o Budget escrito com sucesso chegue ao disco. Os dois sync já
 * são internamente resilientes (last-good, single-flight) — esta authority
 * só garante que uma rejeição de um não interrompe o outro.
 */
export interface WidgetSnapshotSyncs {
  budget: SnapshotSync
  invoices: InvoicesSync
}

/**
 * Dispara os dois syncs em paralelo, isolados um do outro.
 *
 * Não devolve nada: os triggers de hoje (`useEffect` no provider) tratam o
 * sync como side effect resiliente — nenhum chamador precisa saber se
 * Budget ou Invoices individualmente tiveram sucesso para decidir o que
 * fazer a seguir. `allSettled` (em vez de `all`) é o que impede uma
 * rejeição de um dos dois de se propagar para quem chamou.
 */
export async function syncWidgetSnapshots(syncs: WidgetSnapshotSyncs): Promise<void> {
  await Promise.allSettled([syncs.budget.sync(), syncs.invoices.sync()])
}
