/**
 * ══════════════════════════════════════════════════════════════════════════
 * Quando a correção da data de acerto é oferecida
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A ação existe para regularização: quem lança no Cartero um pagamento feito
 * meses atrás grava a data de hoje, e o Orçamento — que reconstrói o histórico
 * por `paidAt` — passa a mostrar a obrigação como pendência anterior em todos
 * os meses intermediários.
 *
 * A regra é a mesma nas cinco superfícies que a expõem (menu mobile e ações
 * desktop de Dívidas e A Receber, mais o Histórico do drawer de Pessoa). Ela
 * vive aqui para não divergir entre elas — cinco cópias inline de
 * `item.isPaid && ...` é exatamente o tipo de coisa que se desalinha na
 * primeira mudança.
 */

/**
 * O mínimo para decidir: só o estado de resolução importa.
 *
 * Estrutural de propósito — Debt e Receivable satisfazem sem precisar ser
 * nomeados, e o helper não fica preso a nenhum dos dois.
 */
interface Settleable {
  isPaid: boolean
}

/**
 * A correção só faz sentido em item RESOLVIDO.
 *
 * Item aberto não tem data de acerto para corrigir, e o backend recusa com
 * `SETTLEMENT_NOT_RESOLVED` — oferecer a ação levaria o usuário a um erro
 * previsível.
 */
export function canEditSettlementDate(item: Settleable): boolean {
  return item.isPaid
}

/** Rótulo da ação, por domínio. */
export function settlementDateActionLabel(
  kind: 'debt' | 'receivable',
): string {
  return kind === 'receivable'
    ? 'Alterar data do recebimento'
    : 'Alterar data do pagamento'
}

/**
 * A data que o diálogo deve exibir como ponto de partida.
 *
 * `null` em legado pago sem data — o diálogo mostra "não registrada" em vez
 * de inventar um valor, e é justamente esse caso que a correção resolve.
 */
export function currentSettlementDate(item: {
  paidAt?: string | null
}): string | null {
  return item.paidAt ?? null
}
