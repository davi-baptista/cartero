import { civilDay } from './date-only.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Quando um agregado terminou de ser liquidado
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Uma row de Pessoa — no Orçamento ou na lista de Pessoas — pode representar
 * vários itens. Quando todos estão resolvidos, a pergunta natural da linha da
 * esquerda é "quando isso acabou?".
 *
 * A resposta é a MAIOR data de liquidação entre eles: o instante em que o
 * último pendente foi quitado e, portanto, em que a relação daquela competência
 * ficou integralmente resolvida.
 *
 * ── Por que a maior, e por que isso NÃO é arbitrário ──
 *
 * A menor diria quando o acerto COMEÇOU a ser resolvido — outro fato, e não o
 * que a row afirma. A do meio não significa nada. A maior é a única que
 * responde a pergunta feita, e por isso `max` aqui não é conveniência de
 * layout: é a definição do evento.
 *
 * ── E por que não inventar ──
 *
 * Um item resolvido sem data confiável torna o conjunto indefensável: exibir a
 * data de outro item como se fosse a conclusão afirmaria um fato que o registro
 * não tem. Nesse caso não há data, e a tela cai num fallback textual.
 *
 * Extraído para cá porque a mesma regra vale em duas superfícies. Duas cópias
 * divergiriam — e a primeira divergência seria justamente qual data escolher.
 */

/** O mínimo que a regra precisa de cada item. */
export interface SettlementDated {
  isPaid: boolean;
  paidAt: Date | null;
}

/**
 * A data em que o agregado ficou integralmente resolvido, ou `null`.
 *
 * `null` em três situações, todas honestas:
 *
 *   · nenhum item resolvido — nada terminou;
 *   · algum item AINDA ABERTO — a relação não terminou;
 *   · algum resolvido sem `paidAt` — não sabemos quando terminou.
 *
 * O segundo caso é o que exige cuidado: com um item aberto, a data do que já
 * foi pago não é a conclusão de nada, e exibi-la sugeriria um acerto encerrado
 * que continua devendo.
 */
export function aggregateSettledAt(
  items: readonly SettlementDated[],
): string | null {
  if (items.length === 0) return null;

  let maior: Date | null = null;

  for (const item of items) {
    /* Um só item aberto e o agregado não terminou de ser liquidado. */
    if (!item.isPaid) return null;
    /* Resolvido sem data: nenhuma outra data pode falar por ele. */
    if (!item.paidAt) return null;

    if (maior === null || item.paidAt > maior) maior = item.paidAt;
  }

  return maior === null ? null : civilDay(maior);
}
