import { TransactionType } from '@/types'

/**
 * Camada de apresentação sobre `TransactionType`.
 *
 * O enum mistura dois eixos: `INCOME` é natureza (entrada), enquanto
 * `CREDIT_CARD`, `DEBIT_CARD`, `PIX` e `BOLETO` são formas de saída. O
 * formulário pergunta as duas coisas separadamente — "o que aconteceu" e, se
 * for gasto, "de que forma" — e este módulo traduz entre as duas visões.
 *
 * Nada aqui muda o que é persistido: o payload continua enviando um único
 * `TransactionType`.
 */

/** O que aconteceu: entrou ou saiu dinheiro. */
export type TransactionKind = 'expense' | 'income'

/** Formas de saída — todas as que o enum realmente tem. */
export const PAYMENT_METHODS = [
  TransactionType.CREDIT_CARD,
  TransactionType.DEBIT_CARD,
  TransactionType.PIX,
  TransactionType.BOLETO,
] as const

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const KIND_LABELS: Record<TransactionKind, string> = {
  expense: 'Gasto',
  income: 'Receita',
}

/** Natureza de um tipo persistido. */
export function kindOf(type: TransactionType): TransactionKind {
  return type === TransactionType.INCOME ? 'income' : 'expense'
}

/**
 * Forma de pagamento de um tipo persistido, ou `null` para receita.
 *
 * Receita não tem forma: o schema não separa natureza de forma de recebimento,
 * então não há o que derivar.
 */
export function methodOf(type: TransactionType): PaymentMethod | null {
  return type === TransactionType.INCOME ? null : (type as PaymentMethod)
}

/** `true` quando o tipo aceita parcelamento, pessoa e estorno. */
export function supportsCreditFeatures(type: TransactionType): boolean {
  return type === TransactionType.CREDIT_CARD
}

/** Campos que só existem em compras de cartão de crédito. */
export interface CreditOnlyFields {
  installments?: number
  personId?: string
  isRefund?: boolean
}

/**
 * Remove os campos que o tipo escolhido não aceita.
 *
 * A política é DESCARTAR ao sair de um modo compatível, nunca guardar para
 * restaurar depois: estado financeiro escondido que reaparece é imprevisível,
 * e o backend recusaria o payload de todo modo. Trocar crédito por PIX e
 * voltar para crédito começa do zero.
 *
 * Estorno também zera o parcelamento e a pessoa — o serviço força um único
 * lançamento no estorno, e a combinação com pessoa é incoerente no domínio.
 */
export function clearIncompatibleFields<T extends CreditOnlyFields>(
  fields: T,
  type: TransactionType,
): T {
  if (!supportsCreditFeatures(type)) {
    return {
      ...fields,
      installments: undefined,
      personId: undefined,
      isRefund: undefined,
    }
  }

  if (fields.isRefund) {
    return { ...fields, installments: undefined, personId: undefined }
  }

  return fields
}
