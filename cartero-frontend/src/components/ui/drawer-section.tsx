import type { ReactNode } from 'react'
import { Check, CircleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DRAWER_WIDE_CONTENT_GUTTER,
  DRAWER_WIDE_CONTENT_INSET,
  DRAWER_WIDE_VERTICAL_RHYTHM,
} from '@/components/ui/drawer-layout'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A geometria das seções de um drawer de detalhe
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Fatura e Pessoa desenhavam a mesma faixa de cabeçalho por caminhos
 * separados, e divergiram onde ninguém olhava: em 390px as rows de Fatura
 * ocupavam 368px e as de Pessoa 320px — 48px a menos para o mesmo tipo de
 * conteúdo.
 *
 * A causa não era uma classe errada numa row: era `px-6` no CONTAINER de
 * scroll de Pessoa. Fatura não tem padding no scroller; cada seção aplica o
 * seu, então as faixas vão de ponta a ponta e só o conteúdo recua. Com o
 * padding no scroller, a faixa nasce recuada e nada dentro dela consegue
 * alcançar a borda.
 *
 * ── O que é compartilhado, e o que não é ──
 *
 * Só GEOMETRIA: onde a faixa começa, que altura tem, onde fica a ação, onde o
 * divisor corta. Conteúdo e domínio continuam de cada drawer — Fatura conta
 * transações e Pessoa conta itens em aberto, e isso não é responsabilidade
 * daqui.
 *
 * Deliberadamente NÃO é um `UniversalFinancialDrawer` com dezenas de props:
 * o que se repetia era o retângulo, não a tela.
 */

/**
 * O recuo horizontal do conteúdo de uma seção.
 *
 * Vive como token porque três lugares precisam concordar: a faixa do
 * cabeçalho, as rows e a mensagem de vazio. Quando um deles diverge, a
 * mensagem "nada em aberto" aparece desalinhada das linhas que ela substitui
 * — e o desalinho é pequeno o bastante para passar despercebido em revisão.
 */
/** Shared section owns the single heading-to-content gap. */
export function DrawerSectionGroup({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col', DRAWER_WIDE_VERTICAL_RHYTHM.sectionContentGap, className)}>
      {children}
    </div>
  )
}

/** Canonical list separators and optional outer horizontal gutter. */
export function DrawerFinancialList({
  children,
  inset = false,
}: {
  children: ReactNode
  /** Apply the horizontal gutter when the parent scroller is edge-to-edge. */
  inset?: boolean
}) {
  return (
    <div className={cn('divide-y divide-border/60', inset && DRAWER_WIDE_CONTENT_GUTTER)}>
      {children}
    </div>
  )
}

/** Shared summary-card surface used at the top of financial detail drawers. */
export function DrawerSummaryCard({
  children,
  className,
  inset = true,
}: {
  children: ReactNode
  className?: string
  /** Omit the card gutter when the parent already applies the wide content inset. */
  inset?: boolean
}) {
  return (
    <div className={cn(inset && DRAWER_WIDE_CONTENT_GUTTER, 'rounded-xl bg-muted/40 p-4', className)}>
      {children}
    </div>
  )
}

/** Shared label typography for wide-drawer summary cards. */
export function DrawerSummaryLabel({
  children,
  emphasis = 'medium',
  className,
}: {
  children: ReactNode
  emphasis?: 'regular' | 'medium'
  className?: string
}) {
  return (
    <p className={cn('text-xs text-muted-foreground', emphasis === 'medium' && 'font-medium', className)}>
      {children}
    </p>
  )
}

/** Shared value typography; tracking and semantic color remain consumer choices. */
export function DrawerSummaryValue({
  children,
  tracking = 'normal',
  className,
}: {
  children: ReactNode
  tracking?: 'normal' | 'tight'
  className?: string
}) {
  return (
    <p className={cn(
      'mt-1 text-2xl font-semibold tabular-nums',
      tracking === 'tight' && 'tracking-[-0.02em]',
      className,
    )}>
      {children}
    </p>
  )
}

/** Shared metadata typography for wide-drawer summary cards. */
export function DrawerSummaryMeta({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-xs text-muted-foreground', className)}>{children}</p>
}

/** Shared temporal status line used by financial drawer summaries. */
export function DrawerCompletionStatus({
  children,
  variant = 'success',
}: {
  children: ReactNode
  variant?: 'success' | 'destructive'
}) {
  const Icon = variant === 'success' ? Check : CircleAlert
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 text-xs font-medium',
      variant === 'success' ? 'text-paid' : 'text-destructive',
    )}>
      <Icon className="size-3.5" aria-hidden />
      {children}
    </span>
  )
}

/** Outlined neutral container for secondary drawer content. */
export function DrawerOutlineCard({
  children,
  className,
  variant = 'default',
}: {
  children: ReactNode
  className?: string
  /** Compact preserves the existing next-occurrence surface in Recurring Income. */
  variant?: 'default' | 'compact'
}) {
  return (
    <div className={cn(
      variant === 'compact'
        ? 'rounded-lg border border-border bg-muted/30 px-3 py-2.5'
        : 'rounded-xl border border-border bg-muted/30 p-4',
      className,
    )}>
      {children}
    </div>
  )
}

/** Unbordered section heading for wide drawers that use a standalone title. */
export function DrawerSectionHeading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={cn('text-sm font-medium', DRAWER_WIDE_VERTICAL_RHYTHM.sectionHeadingPadding, className)}>
      {children}
    </h3>
  )
}

/**
 * A faixa de título de uma seção.
 *
 * `h-11` fixo: sem altura fixa a faixa encolhe quando a ação não aparece, e o
 * cabeçalho muda de tamanho entre uma fatura paga e uma aberta — ou entre uma
 * competência com pendências e outra sem.
 *
 * `pr-2` (menor que o `pl-4`) porque a ação é um botão `ghost`, cuja área de
 * clique já inclui o próprio padding: igualar os dois lados faria a ação
 * parecer afastada da borda enquanto o título parece colado.
 */
export function DrawerSectionHeader({
  title,
  action,
  className,
}: {
  title: ReactNode
  /** Opcional: uma seção sem ação usa a MESMA faixa, só sem o lado direito. */
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex h-11 items-center justify-between gap-2 border-y border-border pl-4 pr-2',
        className,
      )}
    >
      <p className="text-[11px] font-medium text-muted-foreground">{title}</p>
      {action}
    </div>
  )
}

/** Shared title/count typography for countable drawer sections. */
export function DrawerSectionTitle({
  title,
  count,
  suffix,
  className,
}: {
  title: ReactNode
  count: number
  suffix?: ReactNode
  className?: string
}) {
  return (
    <span className={className}>
      {title}{' · '}{count}{suffix}
    </span>
  )
}

/**
 * O vazio de uma seção.
 *
 * Respeita o mesmo recuo das rows: a frase ocupa o lugar da lista, então
 * alinhá-la com o cabeçalho e não com as linhas a faria parecer legenda do
 * título em vez de conteúdo da seção.
 */
export function DrawerSectionEmpty({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <p
      className={cn(
        DRAWER_WIDE_CONTENT_INSET,
        'py-6 text-center text-[11px] text-muted-foreground',
        className,
      )}
    >
      {children}
    </p>
  )
}
