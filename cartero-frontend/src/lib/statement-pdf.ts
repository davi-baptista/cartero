import { jsPDF } from 'jspdf'
import { formatCurrency, formatDate } from '@/lib/formatters'
import type { Debt, Receivable } from '@/types'

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

interface StatementPdfInput {
  personName: string
  periodLabel: string
  netBalance: number
  receivables: Receivable[]
  debts: Debt[]
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
  dueDate: string,
  amount: number,
  color: [number, number, number],
  sign: '+' | '-',
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
  doc.text(`Vence ${dueDate}`, x, y + 4.5)
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

  // Net balance card — Elevated Surface, one tonal step above the page background.
  const cardTop = y + 14
  const cardHeight = 34
  doc.setFillColor(...COLOR_SURFACE)
  doc.roundedRect(margin, cardTop, contentWidth, cardHeight, 3, 3, 'F')

  let cardY = cardTop + 9
  doc.setFont('Inter', 'normal')
  doc.setFontSize(SIZE_LABEL)
  doc.setTextColor(...COLOR_MUTED)
  doc.text(`Extrato de ${input.personName}`, margin + 8, cardY)

  cardY += 11
  const isPositive = input.netBalance >= 0
  doc.setFont('Inter', 'bold')
  doc.setFontSize(SIZE_HEADLINE)
  doc.setTextColor(...(isPositive ? COLOR_RECEIVABLE : COLOR_DESTRUCTIVE))
  doc.text(
    `${isPositive ? '+' : '-'} ${formatCurrency(Math.abs(input.netBalance))}`,
    margin + 8,
    cardY,
  )

  cardY += 7
  doc.setFont('Inter', 'normal')
  doc.setFontSize(SIZE_LABEL)
  doc.setTextColor(...COLOR_MUTED)
  doc.text(
    isPositive
      ? `${input.personName} deve este valor no total`
      : `Valor devido a ${input.personName} no total`,
    margin + 8,
    cardY,
  )

  y = cardTop + cardHeight + 14

  if (input.receivables.length > 0) {
    doc.setFont('Inter', 'medium')
    doc.setFontSize(SIZE_LABEL)
    doc.setTextColor(...COLOR_BRAND)
    doc.text('A RECEBER', margin, y)
    y += 3
    doc.setDrawColor(...COLOR_BORDER)
    doc.line(margin, y, pageWidth - margin, y)
    y += 8

    for (const item of input.receivables) {
      addRow(doc, margin, y, contentWidth, item.title, formatDate(item.dueDate), Number(item.amount), COLOR_RECEIVABLE, '+')
      y += ROW_HEIGHT
    }
    y += 4
  }

  if (input.debts.length > 0) {
    doc.setFont('Inter', 'medium')
    doc.setFontSize(SIZE_LABEL)
    doc.setTextColor(...COLOR_BRAND)
    doc.text('A PAGAR', margin, y)
    y += 3
    doc.setDrawColor(...COLOR_BORDER)
    doc.line(margin, y, pageWidth - margin, y)
    y += 8

    for (const item of input.debts) {
      addRow(doc, margin, y, contentWidth, item.title, formatDate(item.dueDate), Number(item.amount), COLOR_DESTRUCTIVE, '-')
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
