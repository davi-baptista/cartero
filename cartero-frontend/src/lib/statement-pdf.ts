import { jsPDF } from 'jspdf'
import { formatCurrency, formatDate } from '@/lib/formatters'
import type { Debt, Receivable, SettlementItem } from '@/types'
import {
  competenceBalanceLabel,
  competenceBalanceSign,
  type CompetenceSummary,
  type DueContext,
} from '@/lib/person-settlement-view'

// Light equivalents of the same semantic roles used across the app's dark theme.
const COLOR_BACKGROUND: [number, number, number] = [255, 255, 255]
const COLOR_SURFACE: [number, number, number] = [242, 243, 247]
const COLOR_INK: [number, number, number] = [15, 15, 15]
const COLOR_MUTED: [number, number, number] = [115, 115, 115]
const COLOR_BORDER: [number, number, number] = [225, 225, 225]
const COLOR_RECEIVABLE: [number, number, number] = [46, 138, 54]
const COLOR_DESTRUCTIVE: [number, number, number] = [214, 62, 65]
// Confident Indigo — the single accent, used sparingly per the One Voice Rule.
const COLOR_BRAND: [number, number, number] = [88, 90, 231]
// The logo's own gradient corners — light blue top-left fading to darker indigo bottom-right.
const LOGO_GRADIENT_START: [number, number, number] = [81, 103, 250]
const LOGO_GRADIENT_END: [number, number, number] = [49, 57, 237]

// DESIGN.md's type scale (headline:title:body:label = 24:16:14:12) mapped to PDF points,
// keeping the same ratios rather than a literal px→pt conversion.
const SIZE_HEADLINE = 20
const SIZE_TITLE = 13
const SIZE_BODY = 11.5
const SIZE_LABEL = 9

/**
 * O PDF recebe o consolidado PRONTO — não recalcula nada.
 *
 * Antes ele recebia só `netBalance` e a lista de itens, e imprimia o saldo
 * sozinho num card grande. Duas consequências: a composição (quanto a receber,
 * quanto a pagar) não aparecia em lugar nenhum, e um saldo zerado com R$ 500
 * pendentes de cada lado saía do documento como "+ R$ 0,00", indistinguível de
 * uma relação sem pendência alguma.
 *
 * Recebendo o mesmo `summary` que o drawer exibe, os dois não podem divergir.
 */
/**
 * O que o gerador precisa saber de um item para posicioná-lo no tempo.
 *
 * `dueMonth` vem resolvido do backend e NÃO é substituído pela competência
 * selecionada: é ele que faz `Venceu em 28/08` ganhar o ano quando o
 * vencimento cai em outro — a diferença entre uma data legível e uma ambígua.
 */
type PdfTimedItem = SettlementItem<Receivable> | SettlementItem<Debt>

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O documento é MENSAL — inteiro
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O cabeçalho sempre imprimiu o mês selecionado, mas o resumo e a lista vinham
 * do universo all-time: um PDF de "setembro 2026" apresentava R$ 13.080 e 38
 * pendências quando setembro tinha R$ 770 e 5 — incluindo parcelas de 2027 e
 * 2028 de uma série de 24x, que nunca pertenceram ao mês.
 *
 * Quem lê o documento é a outra pessoa, que não tem como saber que o título e
 * os números falam de períodos diferentes.
 *
 * A competência é a MESMA do drawer (`openItemsFor` + `summarizeCompetence`,
 * de `person-settlement-view`): o mês civil de `dueDate`, mais o que venceu
 * antes e continua aberto. O PDF não filtra nada por conta própria — receber
 * o universo já resolvido é o que impede uma terceira semântica temporal.
 */
interface StatementPdfInput {
  personName: string
  /** O mês exportado. Vale para o documento inteiro, não só para o histórico. */
  periodLabel: string
  /** Resumo DO MÊS — `summarizeCompetence` sobre os itens abaixo. */
  summary: CompetenceSummary
  /**
   * Em aberto na competência: vence nela, ou venceu antes e segue aberto.
   *
   * `SettlementItem` e não `Receivable`/`Debt` cru: as competências resolvidas
   * pelo backend são o que permite datar o vencimento sem ambiguidade de ano.
   */
  pendingReceivables: SettlementItem<Receivable>[]
  pendingDebts: SettlementItem<Debt>[]
  /** Resolvidos arquivados nesta competência. */
  settledReceivables: SettlementItem<Receivable>[]
  settledDebts: SettlementItem<Debt>[]
  /**
   * Contexto de vencimento de um item em aberto.
   *
   * Injetado, não calculado aqui: `dueContext` precisa da competência
   * selecionada e do dia civil de hoje, e recriar essa decisão no gerador
   * abriria uma segunda regra de atraso — o documento poderia dizer "vence em"
   * onde a tela diz "em atraso".
   */
  dueContextOf: (item: PdfTimedItem) => DueContext
  /** Microcopy de um item resolvido, com a data real da resolução. */
  resolvedLabelOf: (item: PdfTimedItem, kind: 'debt' | 'receivable') => string
}

async function loadAsDataUrl(path: string): Promise<string> {
  const res = await fetch(path)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function registerInter(doc: jsPDF): Promise<void> {
  const [regularUrl, mediumUrl, boldUrl] = await Promise.all([
    loadAsDataUrl('/fonts/Inter-Regular.ttf'),
    loadAsDataUrl('/fonts/Inter-Medium.ttf'),
    loadAsDataUrl('/fonts/Inter-Bold.ttf'),
  ])
  const toBase64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1)

  doc.addFileToVFS('Inter-Regular.ttf', toBase64(regularUrl))
  doc.addFont('Inter-Regular.ttf', 'Inter', 'normal')
  doc.addFileToVFS('Inter-Medium.ttf', toBase64(mediumUrl))
  doc.addFont('Inter-Medium.ttf', 'Inter', 'medium')
  doc.addFileToVFS('Inter-Bold.ttf', toBase64(boldUrl))
  doc.addFont('Inter-Bold.ttf', 'Inter', 'bold')
}

function lerpColor(
  from: [number, number, number],
  to: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ]
}

// Wave offset for the frame's inner edge — a gentle sine ripple, in mm.
const WAVE_AMPLITUDE = 0.8
const WAVE_CYCLE_LENGTH = 22 // mm per full sine cycle

function waveOffset(distanceAlongEdge: number): number {
  return Math.sin((distanceAlongEdge / WAVE_CYCLE_LENGTH) * Math.PI * 2) * WAVE_AMPLITUDE
}

// Simulates a diagonal gradient border (light top-left → dark bottom-right, matching the
// logo) by drawing each of the four frame strips as a run of thin gradient-stepped quads.
// The outer edge (against the page border) stays straight; the inner edge (against the
// dark content area) ripples with a gentle sine wave.
function drawGradientFrame(doc: jsPDF, pageWidth: number, pageHeight: number, thickness: number) {
  const steps = 90

  function drawStrip(
    pointAt: (t: number) => { outer: [number, number]; inner: [number, number] },
    colorAt: (t: number) => [number, number, number],
  ) {
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps
      const t1 = (i + 1) / steps
      const a = pointAt(t0)
      const b = pointAt(t1)
      doc.setFillColor(...colorAt((t0 + t1) / 2))
      doc.setDrawColor(...colorAt((t0 + t1) / 2))
      // Quad: outer edge straight, inner edge wavy — drawn as a thin closed polygon.
      doc.lines(
        [
          [b.outer[0] - a.outer[0], b.outer[1] - a.outer[1]],
          [b.inner[0] - b.outer[0], b.inner[1] - b.outer[1]],
          [a.inner[0] - b.inner[0], a.inner[1] - b.inner[1]],
        ],
        a.outer[0],
        a.outer[1],
        [1, 1],
        'F',
        true,
      )
    }
  }

  // Top strip.
  drawStrip(
    (t) => ({
      outer: [t * pageWidth, 0],
      inner: [t * pageWidth, thickness + waveOffset(t * pageWidth)],
    }),
    (t) => lerpColor(LOGO_GRADIENT_START, LOGO_GRADIENT_END, t),
  )
  // Bottom strip.
  drawStrip(
    (t) => ({
      outer: [t * pageWidth, pageHeight],
      inner: [t * pageWidth, pageHeight - thickness - waveOffset(t * pageWidth)],
    }),
    (t) => lerpColor(LOGO_GRADIENT_START, LOGO_GRADIENT_END, t),
  )
  // Left strip.
  drawStrip(
    (t) => ({
      outer: [0, t * pageHeight],
      inner: [thickness + waveOffset(t * pageHeight), t * pageHeight],
    }),
    (t) => lerpColor(LOGO_GRADIENT_START, LOGO_GRADIENT_END, t),
  )
  // Right strip.
  drawStrip(
    (t) => ({
      outer: [pageWidth, t * pageHeight],
      inner: [pageWidth - thickness - waveOffset(t * pageHeight), t * pageHeight],
    }),
    (t) => lerpColor(LOGO_GRADIENT_START, LOGO_GRADIENT_END, t),
  )
}

// Row height for the item list — enough room for the title + due-date line to breathe.
const ROW_HEIGHT = 14

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Geometria da página
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O gerador nunca chamava `addPage`: escrevia num único A4 com um cursor que
 * só crescia. Com 87 pendências o cursor chegava a 1312mm numa página de
 * 297mm — o texto entrava no stream do PDF (por isso a extração o encontrava)
 * mas ficava fora do MediaBox, invisível. A row de transição, por volta da
 * 13ª, era desenhada por cima do footer.
 *
 * `FOOTER_RESERVE` é área física reservada em TODAS as páginas: o footer é
 * desenhado dentro dela, e nenhuma row pode entrar. A régua é o baseline da
 * segunda linha da row (`y + 4.5`), não o topo — senão a data da última row
 * caberia embaixo da linha do footer.
 */
const FOOTER_RESERVE = 24
const ROW_TAIL = 5

function addRow(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  title: string,
  /** Primeira parte da linha de metadados, já com o verbo do domínio. */
  dateLabel: string,
  amount: number,
  color: [number, number, number],
  sign: '+' | '-',
  /**
   * Contexto de vencimento, quando o item ainda está em aberto.
   *
   * Ausente nos resolvidos: `Venceu em 28/08` sozinho num item já recebido
   * leria como atraso atual.
   */
  due?: DueContext,
  /** "Compra no cartão", para cobranças geradas por uma transação. */
  origin?: string,
) {
  doc.setFont('Inter', 'normal')
  doc.setFontSize(SIZE_BODY)
  doc.setTextColor(...COLOR_INK)
  doc.text(title, x, y, { maxWidth: width * 0.55 })
  const titleWidth = doc.getTextWidth(title)

  doc.setFont('Inter', 'bold')
  doc.setFontSize(SIZE_BODY)
  const amountText = `${sign} ${formatCurrency(amount)}`
  const amountWidth = doc.getTextWidth(amountText)

  // Dotted leader connecting the title to the amount, like a menu/index price line.
  const leaderStart = x + Math.min(titleWidth, width * 0.55) + 3
  const leaderEnd = x + width - amountWidth - 3
  if (leaderEnd > leaderStart) {
    doc.setLineDashPattern([0.6, 1.2], 0)
    doc.setDrawColor(...COLOR_BORDER)
    doc.line(leaderStart, y - 1, leaderEnd, y - 1)
    doc.setLineDashPattern([], 0)
  }

  doc.setTextColor(...color)
  doc.text(amountText, x + width, y, { align: 'right' })

  /*
    Linha de metadados, desenhada em SEGMENTOS.

    Um único `doc.text` pintaria tudo da mesma cor, e o atraso precisa se
    destacar sem levar a data de origem com ele: só o trecho do vencimento vai
    em vermelho, o resto continua muted. Título e valor nunca mudam de cor —
    um documento inteiro vermelho por causa de uma data não ajuda a ler.
  */
  doc.setFont('Inter', 'normal')
  doc.setFontSize(SIZE_LABEL)

  let metaX = x
  const partes: Array<{ texto: string; cor: [number, number, number] }> = [
    { texto: dateLabel, cor: COLOR_MUTED },
  ]
  if (due) partes.push({ texto: due.text, cor: due.tone === 'overdue' ? COLOR_DESTRUCTIVE : COLOR_MUTED })
  // Origem sem id interno: o documento é financeiro, não técnico.
  if (origin) partes.push({ texto: origin, cor: COLOR_MUTED })

  partes.forEach((parte, i) => {
    if (i > 0) {
      doc.setTextColor(...COLOR_MUTED)
      doc.text(' · ', metaX, y + 4.5)
      metaX += doc.getTextWidth(' · ')
    }
    doc.setTextColor(...parte.cor)
    doc.text(parte.texto, metaX, y + 4.5)
    metaX += doc.getTextWidth(parte.texto)
  })
}

/**
 * Frase que explica o saldo do mês para quem recebe o documento.
 *
 * Espelha `balanceSentence`, mas no vocabulário da competência: um mês sem
 * itens diz "Nada a acertar neste mês", nunca "Nenhuma pendência em aberto" —
 * que afirmaria quitação de uma relação que pode ter pendências em outros
 * meses.
 *
 * O caso de compensação diz explicitamente que há pendências: saldo zero com
 * R$ 500 de cada lado não é acerto concluído.
 */
function competenceSentence(
  summary: CompetenceSummary,
  personName: string,
): string {
  if (summary.isEmpty) return 'Nada a acertar neste mês'

  const value = formatCurrency(Math.abs(summary.net))

  if (summary.net > 0.005) return `${personName} deve ${value} a você neste mês`
  if (summary.net < -0.005) return `Você deve ${value} a ${personName} neste mês`

  return `Os valores se compensam, mas ${summary.itemCount} pendência(s) seguem em aberto`
}

export async function generateStatementPdf(input: StatementPdfInput): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  await registerInter(doc)

  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const frameThickness = 3
  const margin = frameThickness + WAVE_AMPLITUDE + 13
  const contentWidth = pageWidth - margin * 2

  /* Fundo e moldura são por PÁGINA — cada página nova recebe os dois. */
  function paintPageChrome() {
    doc.setFillColor(...COLOR_BACKGROUND)
    doc.rect(0, 0, pageWidth, pageHeight, 'F')
    drawGradientFrame(doc, pageWidth, pageHeight, frameThickness)
  }

  /* Footer dentro da área reservada, repetido em toda página. */
  function paintFooter() {
    doc.setDrawColor(...COLOR_BORDER)
    doc.line(margin, pageHeight - 18, pageWidth - margin, pageHeight - 18)
    doc.setFont('Inter', 'normal')
    doc.setFontSize(SIZE_LABEL - 1)
    doc.setTextColor(...COLOR_MUTED)
    doc.text('Gerado pelo Cartero', margin, pageHeight - 12)
    doc.text(
      formatDate(new Date().toISOString().slice(0, 10)),
      pageWidth - margin,
      pageHeight - 12,
      { align: 'right' },
    )
  }

  paintPageChrome()

  let y = margin + 2

  /** A última coordenada utilizável antes da área do footer. */
  const contentBottom = pageHeight - FOOTER_RESERVE

  /**
   * Garante `needed` mm de espaço, abrindo página quando não houver.
   *
   * É o que substitui o cursor infinito. O chamador passa a altura do bloco
   * INTEIRO que vai desenhar, então uma row nunca começa numa página e termina
   * na outra (`break-inside: avoid`, na prática).
   */
  function ensureSpace(needed: number) {
    if (y + needed <= contentBottom) return
    paintFooter()
    doc.addPage()
    paintPageChrome()
    y = margin + 6
  }

  const logoDataUrl = await loadAsDataUrl('/logo-vertical-sem-nome.png')
  const logoSize = 8
  doc.addImage(logoDataUrl, 'PNG', margin, y - 5.5, logoSize, logoSize)
  doc.setFont('Inter', 'bold')
  doc.setFontSize(SIZE_TITLE)
  doc.setTextColor(...COLOR_INK)
  doc.text('cartero', margin + 11, y + 0.5)

  doc.setFont('Inter', 'normal')
  doc.setFontSize(SIZE_LABEL)
  doc.setTextColor(...COLOR_MUTED)
  doc.text('Extrato de dívidas e cobranças', pageWidth - margin, y - 2.5, { align: 'right' })
  doc.text(input.periodLabel, pageWidth - margin, y + 2, { align: 'right' })

  /*
    Card do MÊS — o mesmo universo do cabeçalho ao lado.

    Antes era "Situação atual", all-time, justificado por um rótulo que
    distinguia os dois períodos. Na prática o documento pedia que o leitor
    fizesse essa separação sozinho: título de setembro, saldo de todos os
    tempos, lista de todos os tempos.
  */
  const { summary } = input
  const cardTop = y + 14
  const cardHeight = 46
  doc.setFillColor(...COLOR_SURFACE)
  doc.roundedRect(margin, cardTop, contentWidth, cardHeight, 3, 3, 'F')

  let cardY = cardTop + 9
  doc.setFont('Inter', 'medium')
  doc.setFontSize(SIZE_LABEL)
  doc.setTextColor(...COLOR_MUTED)
  doc.text(input.periodLabel.toUpperCase(), margin + 8, cardY)

  cardY += 11
  const netBalance = summary.net
  const positive = netBalance > 0.005
  const negative = netBalance < -0.005
  doc.setFont('Inter', 'bold')
  doc.setFontSize(SIZE_HEADLINE)
  doc.setTextColor(
    ...(positive
      ? COLOR_RECEIVABLE
      : negative
        ? COLOR_DESTRUCTIVE
        : COLOR_INK),
  )
  const signGlyph = competenceBalanceSign(summary)
  const sign = signGlyph ? `${signGlyph} ` : ''
  doc.text(
    `${sign}${formatCurrency(Math.abs(netBalance))}`,
    margin + 8,
    cardY,
  )

  // Rótulo do saldo à direita do valor, da mesma fonte que o drawer usa.
  doc.setFont('Inter', 'normal')
  doc.setFontSize(SIZE_LABEL)
  doc.setTextColor(...COLOR_MUTED)
  doc.text(competenceBalanceLabel(summary), pageWidth - margin - 8, cardY, {
    align: 'right',
  })

  cardY += 7
  doc.text(competenceSentence(summary, input.personName), margin + 8, cardY)

  /*
    Composição sempre impressa junto do saldo.

    É o que impede o documento de afirmar por omissão que houve compensação
    entre as obrigações: R$ 500 a receber e R$ 200 a pagar são dois fatos
    separados que somam R$ 300 apenas como informação.
  */
  cardY += 8
  doc.setFont('Inter', 'medium')
  doc.setFontSize(SIZE_BODY - 1)
  doc.setTextColor(...COLOR_RECEIVABLE)
  doc.text(
    `A receber ${formatCurrency(summary.receivableTotal)}`,
    margin + 8,
    cardY,
  )
  doc.setTextColor(...COLOR_DESTRUCTIVE)
  doc.text(
    `A pagar ${formatCurrency(summary.debtTotal)}`,
    margin + 58,
    cardY,
  )
  doc.setFont('Inter', 'normal')
  doc.setTextColor(...COLOR_MUTED)
  doc.text(
    `${summary.itemCount} pendência(s)`,
    pageWidth - margin - 8,
    cardY,
    { align: 'right' },
  )

  y = cardTop + cardHeight + 14

  /**
   * Cabeçalho de seção.
   *
   * Reserva o próprio espaço MAIS a primeira row: um "A PAGAR — PENDENTE"
   * sozinho no pé da página faria a seção parecer vazia.
   */
  function sectionTitle(label: string) {
    ensureSpace(11 + ROW_HEIGHT)
    doc.setFont('Inter', 'medium')
    doc.setFontSize(SIZE_LABEL)
    doc.setTextColor(...COLOR_BRAND)
    doc.text(label, margin, y)
    y += 3
    doc.setDrawColor(...COLOR_BORDER)
    doc.line(margin, y, pageWidth - margin, y)
    y += 8
  }

  if (input.pendingReceivables.length > 0) {
    sectionTitle('A RECEBER — PENDENTE')
    for (const item of input.pendingReceivables) {
      ensureSpace(ROW_TAIL)
      addRow(
        doc,
        margin,
        y,
        contentWidth,
        item.title,
        /*
          "Lançada em" é o termo que os detalhes de dívida e cobrança já usam
          para `occurredAt`. O PDF dizia só "Em 10/08/2026", e quem recebia o
          documento lia aquilo como vencimento — no caso real a cobrança era de
          10/08 e vencia em 28/08, então o documento não dizia que já havia
          vencido.
        */
        `Lançada em ${formatDate(item.occurredAt)}`,
        Number(item.amount),
        COLOR_RECEIVABLE,
        '+',
        input.dueContextOf(item),
        item.transactionId ? 'Compra no cartão' : undefined,
      )
      y += ROW_HEIGHT
    }
    y += 4
  }

  if (input.pendingDebts.length > 0) {
    sectionTitle('A PAGAR — PENDENTE')
    for (const item of input.pendingDebts) {
      ensureSpace(ROW_TAIL)
      addRow(
        doc,
        margin,
        y,
        contentWidth,
        item.title,
        `Lançada em ${formatDate(item.occurredAt)}`,
        Number(item.amount),
        COLOR_DESTRUCTIVE,
        '-',
        input.dueContextOf(item),
      )
      y += ROW_HEIGHT
    }
    y += 4
  }

  /*
    Histórico do período — a única seção que o seletor de mês governa.

    Separada e rotulada com o período, para não ser lida como pendência.
  */
  const history = [
    ...input.settledReceivables.map((item) => ({ item, kind: 'r' as const })),
    ...input.settledDebts.map((item) => ({ item, kind: 'd' as const })),
  ]

  if (history.length > 0) {
    sectionTitle(`QUITADO — ${input.periodLabel.toUpperCase()}`)
    for (const { item, kind } of history) {
      ensureSpace(ROW_TAIL)
      addRow(
        doc,
        margin,
        y,
        contentWidth,
        item.title,
        `Lançada em ${formatDate(item.occurredAt)}`,
        Number(item.amount),
        COLOR_MUTED,
        kind === 'r' ? '+' : '-',
        /*
          Resolvido não recebe contexto de vencimento: "Venceu em 28/08" num
          item já recebido leria como atraso atual. Quem informa a resolução é
          `input.resolvedLabelOf`, com a data real em que o dinheiro se moveu.
        */
        undefined,
        input.resolvedLabelOf(item, kind === 'r' ? 'receivable' : 'debt'),
      )
      y += ROW_HEIGHT
    }
  }

  /* A última página fecha com o mesmo footer das anteriores. */
  paintFooter()

  return doc
}

export function statementPdfFileName(personName: string): string {
  const slug = personName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return `extrato-${slug}.pdf`
}
