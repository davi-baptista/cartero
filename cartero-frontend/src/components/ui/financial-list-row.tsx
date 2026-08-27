import type { ReactNode } from 'react'
import Link from 'next/link'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'
import { cn } from '@/lib/utils'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A linguagem de lista financeira
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A anatomia canônica veio do Extrato, que já era a lista mais madura:
 *
 *   [ícone] Título >              -R$ 19,90
 *           metadata compacta     20/08/2026
 *
 * Extrato, Bancos, Dívidas e A Receber tinham a MESMA anatomia escrita quatro
 * vezes, e já haviam divergido no que menos se percebe de perto: Extrato
 * respirava `py-3.5` com avatar de 40px; Dívidas e A Receber usavam `py-3`
 * com avatar de 32px. Lado a lado, uma tela parecia apertada em relação à
 * outra sem que ninguém soubesse apontar por quê.
 *
 * Este componente NÃO é um layout universal. Ele fixa o RITMO — escala
 * tipográfica, altura, respiro, divisor, chevron — e deixa o conteúdo de cada
 * slot inteiramente a cargo de quem chama. Bancos mostra "FATURA ATUAL" onde
 * o Extrato mostra data, e isso é correto: mesma hierarquia, dados diferentes.
 *
 * O que ele deliberadamente NÃO faz:
 *
 *   - não decide cor de valor (semântica de cada domínio);
 *   - não conhece Debt, Receivable, Bank ou Transaction;
 *   - não recebe `variant` por página — isso reabriria a divergência com
 *     outro nome.
 */

/* ── Tokens canônicos ──────────────────────────────────────────────────────
   Exportados porque algumas telas montam conteúdo de slot por fora (Bancos
   monta o bloco direito inteiro). Sem isso elas recriariam os valores à mão,
   que é exatamente como a divergência começou. */

/** Título da row. */
export const ROW_TITLE_CLASS =
  'truncate text-sm font-medium leading-tight sm:text-[15px]'

/** Metadata compacta abaixo do título. */
export const ROW_META_CLASS =
  'flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground'

/** Valor principal, à direita. A COR fica por conta do domínio. */
export const ROW_AMOUNT_CLASS =
  'text-[17px] font-semibold tabular-nums tracking-[-0.02em]'

/** Informação secundária sob o valor (data, rótulo). */
export const ROW_TRAILING_META_CLASS = 'text-xs text-muted-foreground'

/** Container do ícone/avatar. O conteúdo interno é livre. */
export const ROW_ICON_CLASS =
  'flex size-10 shrink-0 items-center justify-center rounded-xl sm:size-11 sm:rounded-2xl'

/**
 * Geometria da row: gap, padding e hover.
 *
 * `px-0` no mobile e `sm:px-2` no desktop — o respiro lateral do celular vem
 * do container da página, e duplicá-lo aqui roubaria largura do título, que é
 * onde ela faz falta a 390px.
 */
const ROW_SHELL_CLASS =
  'group flex w-full min-w-0 items-center gap-3 rounded-lg px-0 py-3.5 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/50 sm:gap-4 sm:px-2 sm:py-4'

export interface FinancialListRowProps {
  /** Ícone/avatar. Vem pronto: o símbolo é do domínio, o container é daqui. */
  leading: ReactNode
  title: ReactNode
  /**
   * Badges e marcadores após o título, ANTES do chevron.
   *
   * O chevron é sempre o último elemento da linha do título — em Bancos ele
   * já vinha depois da badge, e essa é a posição que as quatro telas passam
   * a compartilhar.
   */
  titleAdornment?: ReactNode
  /** Metadata compacta. Já vem com a classe aplicada pelo wrapper. */
  meta?: ReactNode
  /**
   * Linha extra abaixo da metadata, dentro da coluna do título.
   *
   * Existe para a descrição livre do Extrato. Fica fora de `meta` porque
   * aquela linha é inline e truncada; esta é um parágrafo próprio.
   */
  belowMeta?: ReactNode
  /** Bloco direito: valor e, abaixo, informação secundária. */
  trailing?: ReactNode
  /**
   * Bloco direito alternativo para telas estreitas.
   *
   * O Extrato esconde a data no mobile e mostra só o valor; sem isso, título
   * e valor disputam a mesma linha a 390px.
   */
  trailingCompact?: ReactNode
  /** Abre o detalhe. A row inteira é o alvo — nunca só o chevron. */
  onView?: () => void
  /**
   * Navegação para outra página, em vez de abrir um detalhe local.
   *
   * Bancos usa isto: é troca de página de verdade, e um `button` perderia
   * clique do meio, "abrir em nova aba" e o destino na barra de status. Passe
   * `href` OU `onView` — o elemento muda, a geometria não.
   */
  href?: string
  /** Descrição para leitor de tela — a row é um `button` sem texto próprio. */
  ariaLabel: string
  className?: string
  /** Destaque temporário de `?highlight=`. */
  ref?: React.Ref<HTMLButtonElement>
}

export function FinancialListRow({
  leading,
  title,
  titleAdornment,
  meta,
  belowMeta,
  trailing,
  trailingCompact,
  onView,
  href,
  ariaLabel,
  className,
  ref,
}: FinancialListRowProps) {
  const conteudo = (
    <>
      {leading}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={ROW_TITLE_CLASS}>{title}</span>
          {titleAdornment}
          {/*
            Sempre presente em row clicável: é a affordance que diz "isto
            abre". A área de clique é a row inteira — o chevron nunca é o
            alvo que o usuário precisa acertar.
          */}
          <DisclosureChevron />
        </span>

        {meta && <div className={ROW_META_CLASS}>{meta}</div>}
        {belowMeta}
      </div>

      {trailing && (
        <div
          className={cn(
            'shrink-0 flex-col items-end gap-1',
            trailingCompact ? 'hidden sm:flex' : 'flex',
          )}
        >
          {trailing}
        </div>
      )}

      {trailingCompact && (
        <div className="flex shrink-0 sm:hidden">{trailingCompact}</div>
      )}
    </>
  )

  const classes = cn(ROW_SHELL_CLASS, className)

  /*
    `Link` ou `button` conforme o uso, com as MESMAS classes. O `button`
    mantém Enter/Espaço e foco de graça; o `Link` preserva as affordances de
    navegação. Reimplementar qualquer um dos dois numa `div` clicável perderia
    acessibilidade.
  */
  if (href) {
    return (
      <Link href={href} aria-label={ariaLabel} className={classes}>
        {conteudo}
      </Link>
    )
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onView}
      aria-label={ariaLabel}
      className={classes}
    >
      {conteudo}
    </button>
  )
}
