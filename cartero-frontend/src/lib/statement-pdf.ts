import { jsPDF } from 'jspdf'
import { formatCurrency, formatDate } from '@/lib/formatters'
import type { Debt, PersonSummary, Receivable } from '@/types'
import { balanceLabel, balanceSentence } from '@/lib/person-statement'

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
interface StatementPdfInput {
  personName: string
  /** Rótulo do mês escolhido — vale para a seção de histórico, não para o resumo. */
  periodLabel: string
  /** Situação atual: all-time. Alimenta o card "SITUAÇÃO ATUAL". */
  summary: PersonSummary
  /** Pendências abertas — all-time, como o `summary`. */
  pendingReceivables: Receivable[]
  pendingDebts: Debt[]
  /** Quitados NO PERÍODO — o universo temporal, seção separada. */
  settledReceivables: Receivable[]
  settledDebts: Debt[]
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

function addRow(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  title: string,
  occurredAt: string,
  amount: number,
  color: [number, number, number],
  sign: '+' | '-',
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

  doc.setFont('Inter', 'normal')
  doc.setFontSize(SIZE_LABEL)
  doc.setTextColor(...COLOR_MUTED)
  // Origem sem id interno: o documento é financeiro, não técnico.
  doc.text(origin ? `Em ${occurredAt} · ${origin}` : `Em ${occurredAt}`, x, y + 4.5)
}

export async function generateStatementPdf(input: StatementPdfInput): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  await registerInter(doc)

  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const frameThickness = 3
  const margin = frameThickness + WAVE_AMPLITUDE + 13
  const contentWidth = pageWidth - margin * 2

  doc.setFillColor(...COLOR_BACKGROUND)
  doc.rect(0, 0, pageWidth, pageHeight, 'F')
  drawGradientFrame(doc, pageWidth, pageHeight, frameThickness)

  let y = margin + 2

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
    Card de "Situação atual" — sempre all-time.

    O rótulo diz explicitamente "Situação atual" porque o cabeçalho ao lado
    mostra um período: sem essa distinção o leitor somaria as duas coisas e
    entenderia que o saldo é do mês.
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
  doc.text('SITUAÇÃO ATUAL', margin + 8, cardY)

  cardY += 11
  const netBalance = summary.netBalance
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
  const sign = positive ? '+ ' : negative ? '- ' : ''
  doc.text(
    `${sign}${formatCurrency(Math.abs(netBalance))}`,
    margin + 8,
    cardY,
  )

  // Rótulo do saldo à direita do valor, da mesma fonte que o drawer usa.
  doc.setFont('Inter', 'normal')
  doc.setFontSize(SIZE_LABEL)
  doc.setTextColor(...COLOR_MUTED)
  doc.text(balanceLabel(summary), pageWidth - margin - 8, cardY, {
    align: 'right',
  })

  cardY += 7
  doc.text(balanceSentence(summary, input.personName), margin + 8, cardY)

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
    `A receber ${formatCurrency(summary.receivablePending)}`,
    margin + 8,
    cardY,
  )
  doc.setTextColor(...COLOR_DESTRUCTIVE)
  doc.text(
    `A pagar ${formatCurrency(summary.debtPending)}`,
    margin + 58,
    cardY,
  )
  doc.setFont('Inter', 'normal')
  doc.setTextColor(...COLOR_MUTED)
  doc.text(
    `${summary.pendingReceivablesCount + summary.pendingDebtsCount} pendência(s)`,
    pageWidth - margin - 8,
    cardY,
    { align: 'right' },
  )

  y = cardTop + cardHeight + 14

  function sectionTitle(label: string) {
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
      addRow(
        doc,
        margin,
        y,
        contentWidth,
        item.title,
        formatDate(item.occurredAt),
        Number(item.amount),
        COLOR_RECEIVABLE,
        '+',
        item.transactionId ? 'Compra no cartão' : undefined,
      )
      y += ROW_HEIGHT
    }
    y += 4
  }

  if (input.pendingDebts.length > 0) {
    sectionTitle('A PAGAR — PENDENTE')
    for (const item of input.pendingDebts) {
      addRow(doc, margin, y, contentWidth, item.title, formatDate(item.occurredAt), Number(item.amount), COLOR_DESTRUCTIVE, '-')
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
      addRow(
        doc,
        margin,
        y,
        contentWidth,
        item.title,
        formatDate(item.occurredAt),
        Number(item.amount),
        COLOR_MUTED,
        kind === 'r' ? '+' : '-',
        kind === 'r' ? 'Recebido' : 'Pago',
      )
      y += ROW_HEIGHT
    }
  }

  doc.setDrawColor(...COLOR_BORDER)
  doc.line(margin, pageHeight - 18, pageWidth - margin, pageHeight - 18)
  doc.setFont('Inter', 'normal')
  doc.setFontSize(SIZE_LABEL - 1)
  doc.setTextColor(...COLOR_MUTED)
  doc.text('Gerado pelo Cartero', margin, pageHeight - 12)
  doc.text(formatDate(new Date().toISOString().slice(0, 10)), pageWidth - margin, pageHeight - 12, { align: 'right' })

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
