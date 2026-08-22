import type { Bank } from '@/types'

/**
 * Nome de banco para exibição.
 *
 * O backend cria um banco interno chamado `__system_receivables__` para
 * ancorar as cobranças automáticas que não têm cartão de verdade. Ele é
 * excluído de `GET /banks`, mas continua chegando à interface EMBUTIDO nos
 * registros que o referenciam (`transaction.bank`, `invoice.bank`) — e aí seu
 * nome técnico aparecia cru na tela.
 *
 * O usuário nunca escolheu esse banco e não pode selecioná-lo; o rótulo diz o
 * que ele significa para quem lê, não como se chama no banco de dados.
 */
export const SYSTEM_BANK_LABEL = 'Não informado'

export function bankDisplayName(
  bank: Pick<Bank, 'name' | 'isSystem'> | null | undefined,
  fallback = SYSTEM_BANK_LABEL,
): string {
  if (!bank) return fallback
  return bank.isSystem ? SYSTEM_BANK_LABEL : bank.name
}

/**
 * `true` quando o banco não pode ser oferecido numa seleção.
 *
 * Vale tanto para o banco de sistema quanto para o caso de ausência: nos dois
 * o usuário não tem o que escolher.
 */
export function isSelectableBank(
  bank: Pick<Bank, 'isSystem'> | null | undefined,
): boolean {
  return bank !== null && bank !== undefined && !bank.isSystem
}
