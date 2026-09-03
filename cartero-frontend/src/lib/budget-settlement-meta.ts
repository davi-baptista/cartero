import { formatDateValue } from '@/lib/date'
import { formatDate } from '@/lib/formatters'
import {
  isNextItemOverdue,
  nextItemLabel,
  type NextSettlementItem,
} from '@/lib/person-next-item'
import { subtextTone } from '@/lib/person-period-view'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A metadata das rows de acerto no Orçamento
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── Row ABERTA: o prazo, não a composição ──
 *
 * A row mostrava a composição bilateral abaixo do nome:
 *
 *   Fabricio
 *   R$ 10,00 a receber · R$ 11,00 a pagar        R$ 1,00
 *                                                VOCÊ DEVE
 *
 * Aquilo era METADATA DE RECURSO: o payload do Orçamento levava somas e um
 * booleano de atraso, sem `dueDate`, então a tela sabia que havia urgência mas
 * não conseguia dizer quando. A composição preenchia a linha com o que havia.
 *
 * Com `open.nextItem` no payload, o prazo assume — a mesma pergunta que a linha
 * de baixo responde em Pessoas e em Bancos: "o que acontece temporalmente?".
 *
 * A composição não foi perdida: continua no `open` do read model e no drawer da
 * pessoa, que é a superfície de detalhe. Saiu da hierarquia principal da lista,
 * não do domínio.
 *
 * ── Row RESOLVIDA: quando, à esquerda; como, à direita ──
 *
 * A row resolvida não tinha nada à esquerda além do nome, e ficava
 * visualmente solta:
 *
 *   Eva                                          R$ 330,00
 *                                                PAGO
 *
 * "Pago" abaixo do nome resolveria o vazio e criaria outro problema — o mesmo
 * estado dito duas vezes, a duplicação que a fase anterior removeu.
 *
 * `Quitado em 18/08` não é duplicação: a esquerda responde QUANDO o acerto
 * terminou de ser liquidado, e o trailing responde COMO ele foi resolvido
 * (`PAGO` ou `RECEBIDO`). Duas informações, dois lugares.
 *
 * O verbo é único de propósito — "Quitado" serve aos dois sentidos, e é o que
 * evita "Pago em 18/08 · PAGO" na mesma linha.
 */

/**
 * `YYYY-MM-DD` → `Date` no fuso LOCAL.
 *
 * `new Date('2026-09-10')` seria lido como UTC e, em Fortaleza (UTC-3),
 * voltaria para 09/09 — o off-by-one que o resto do código evita comparando
 * strings. Aqui a conversão é necessária porque `timingUrgency` recebe `Date`.
 */
function diaCivil(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** O que a metadata precisa saber da row. */
export interface SettlementMetaSource {
  nextItem: NextSettlementItem | null | undefined
  /** `YYYY-MM-DD` civil, ou `null` quando não há data defensável. */
  settledAt: string | null | undefined
}

export interface SettlementMeta {
  text: string
  /** Classe de tom, ou string vazia para o neutro. */
  tone: string
}

/**
 * Metadata de uma row EM ABERTO.
 *
 * `null` quando não há evento — pessoa sem pendência datada, ou saldo zero com
 * itens dos dois lados, onde não existe um sentido a destacar. A row fica sem
 * subtexto em vez de exibir texto que não informa.
 *
 * O texto e o tom vêm dos helpers canônicos (`nextItemLabel`, `subtextTone`),
 * os MESMOS de Pessoas: "Pagar atrasado 3d" / "Pagar hoje" / "Pagar amanhã" /
 * "Pagar em 5d", com vermelho no atraso, âmbar em ≤7 dias e neutro no resto.
 */
export function openSettlementMeta(
  source: SettlementMetaSource,
  today: string = formatDateValue(),
): SettlementMeta | null {
  const text = nextItemLabel(source.nextItem, today)
  if (!text) return null

  return { text, tone: subtextTone(source.nextItem ?? null, diaCivil(today)) }
}

/**
 * Metadata de uma row RESOLVIDA.
 *
 * Com data: `Quitado em 18/08` — o dia em que o último item pendente foi
 * liquidado, e portanto em que o agregado ficou integralmente resolvido.
 *
 * Sem data: `Acerto concluído`. Honesto em vez de inventado — nada aqui
 * escolhe uma data qualquer para preencher a linha.
 *
 * Sempre neutro: um acerto concluído não tem prazo a cumprir, e o verde de
 * conclusão já está no trailing. Pintar a data também faria a linha inteira
 * comunicar sucesso duas vezes.
 */
export function settledSettlementMeta(
  source: SettlementMetaSource,
): SettlementMeta {
  if (!source.settledAt) return { text: 'Acerto concluído', tone: '' }

  return { text: `Quitado em ${formatDate(source.settledAt)}`, tone: '' }
}

/**
 * A metadata da row, pelo seu estado.
 *
 * Uma função porque a escolha entre prazo e conclusão é a mesma decisão vista
 * de dois lados — e mantê-las juntas impede que uma row resolvida volte a
 * exibir prazo, ou uma aberta a exibir conclusão.
 */
export function settlementRowMeta(
  status: 'open' | 'settled',
  source: SettlementMetaSource,
  today: string = formatDateValue(),
): SettlementMeta | null {
  return status === 'settled'
    ? settledSettlementMeta(source)
    : openSettlementMeta(source, today)
}

/** O prazo está vencido? Exposto para quem precisa só do sinal. */
export function isSettlementOverdue(
  source: SettlementMetaSource,
  today: string = formatDateValue(),
): boolean {
  return isNextItemOverdue(source.nextItem, today)
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Metadata de uma linha de DÍVIDA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Uma dívida tem um só sentido — sai do bolso —, então não há direção a
 * resolver: o verbo é sempre "Pagar". `nextItemLabel` já produz a frase certa
 * recebendo `direction: 'pay'`, e reusá-lo mantém a régua de dias e o
 * vocabulário idênticos aos de Pessoas.
 *
 * Resolvida usa o mesmo `Quitado em DD/MM` das rows de acerto: o trailing diz
 * `PAGA`, e repetir a palavra à esquerda seria a duplicação já removida.
 */
export function debtRowMeta(
  row: { dueDate: string | null; settledAt: string | null; isPaid: boolean },
  today: string = formatDateValue(),
): SettlementMeta | null {
  if (row.isPaid) {
    return row.settledAt
      ? { text: `Quitado em ${formatDate(row.settledAt)}`, tone: '' }
      : /*
          Paga sem data defensável. "Acerto concluído" é a frase das rows
          agregadas; aqui a linha é uma obrigação, e "Pagamento concluído"
          diria o mesmo sobre o objeto certo.
        */
        { text: 'Pagamento concluído', tone: '' }
  }

  if (!row.dueDate) return null

  const item: NextSettlementItem = { direction: 'pay', dueDate: row.dueDate }
  const text = nextItemLabel(item, today)

  return text === null ? null : { text, tone: subtextTone(item, diaCivil(today)) }
}
