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

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O tom do subtexto quando a row está RESOLVIDA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O trailing de uma row quitada é verde (`PAGA`, `PAGO`, `RECEBIDO`), mas o
 * subtexto abaixo do nome saía neutro — e os dois falam do MESMO fato:
 *
 *   Curso online                             R$ 420,00
 *   Venceu em 25/08/2026 · Eva [cinza]            PAGA [verde]
 *
 * Meia linha concluída. Com a cor compartilhada, a row se lê como resolvida de
 * relance, sem o leitor precisar cruzar os dois lados.
 *
 * ── Verde é SUCESSO, não direção ──
 *
 * Nesta rodada verde significa quitado/pago/recebido. Não é "dinheiro
 * entrando": um recebível pendente continua sem verde, e o valor principal
 * segue neutro em todos os estados.
 *
 * ── Um token, três superfícies ──
 *
 * Bancos já aplicava a regra (via `invoice-row-presenter`); Orçamento e
 * Pessoas não. Três definições de "o verde do resolvido" divergiriam na
 * primeira mudança — e a divergência que esta rodada corrige nasceu
 * exatamente assim.
 */
export const ROW_RESOLVED_TONE = 'text-paid'

/** Metadata compacta abaixo do título. */
export const ROW_META_CLASS =
  'flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground'

/** Valor principal, à direita. A COR fica por conta do domínio. */
export const ROW_AMOUNT_CLASS =
  'text-[17px] font-semibold tabular-nums tracking-[-0.02em]'

/** Informação secundária sob o valor — data, período. */
export const ROW_TRAILING_META_CLASS = 'text-xs text-muted-foreground'

/**
 * Rótulo em versalete sob o valor: "A RECEBER", "FATURA ATUAL", "SEM SALDO".
 *
 * Alternativa ao `ROW_TRAILING_META_CLASS` quando a linha nomeia o que o
 * número É, em vez de datá-lo. Pessoas e Bancos escreviam esta mesma string
 * de sete classes cada uma por sua conta.
 */
export const ROW_TRAILING_LABEL_CLASS =
  'whitespace-nowrap text-[10px] uppercase tracking-[0.06em] text-muted-foreground/70'

/**
 * ── Cores do valor ──
 *
 * A direção do dinheiro, não o status. Ficam aqui porque eram o último
 * pedaço da row decidido tela a tela — e o Extrato divergia de verdade:
 * usava `--color-income` (oklch 0.700/0.170), um verde mais claro e saturado
 * que o `--receivable` (0.600/0.150) de todas as outras listas. Lado a lado,
 * a mesma entrada de dinheiro tinha dois verdes.
 *
 * `text-receivable` venceu por ser o que dez arquivos já usavam.
 *
 * NEUTRO é ausência de direção — saldo zero, valor informativo —, não um
 * caso "sem cor definida": ele herda o `foreground` da row de propósito.
 */
export const ROW_AMOUNT_TONE = {
  /** Sai do bolso. */
  out: 'text-destructive',
  /** Entra no bolso. */
  in: 'text-receivable',
  /** Sem direção: informativo ou zerado. */
  neutral: '',
  /** Resolvido — perde ênfase sem mudar de significado. */
  muted: 'text-muted-foreground',
} as const

export type RowAmountTone = keyof typeof ROW_AMOUNT_TONE

/**
 * Fundo NEUTRO do container do ícone.
 *
 * `--color-expense-bg`, o mesmo do Extrato — e o motivo de ser um token e não
 * um `bg-muted/*`: ele muda com o tema (preto a 5% no claro, branco a 5% no
 * escuro), enquanto uma opacidade sobre `muted` mantém o mesmo cinza nos dois.
 *
 * Cada tela tinha escolhido o seu: `bg-muted` em Pessoas, `bg-muted/40` em
 * Bancos e Orçamento, `bg-muted/50` em Dívidas e A Receber. Diferenças
 * pequenas demais para alguém apontar de memória, grandes o bastante para as
 * listas nunca parecerem a mesma família ao alternar entre elas.
 *
 * Fundo COLORIDO (receita, atraso) continua por conta do domínio: aqui mora
 * só o neutro, que era o que estava divergindo.
 */
export const ROW_ICON_BG_CLASS = 'bg-[var(--color-expense-bg)]'

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
/*
  `cursor-pointer` porque a row INTEIRA é o alvo de clique.

  Ela é um `button` ou um `Link`, e o navegador só mostra a mãozinha
  automaticamente em `<a href>` — num `button` o cursor fica de seta, e a
  affordance dependia só do fundo do hover. `StatusListRow` (Orçamento) já
  trazia; estas não.
*/
const ROW_SHELL_CLASS =
  'group flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg px-0 py-3.5 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/50 sm:gap-4 sm:px-2 sm:py-4'

/*
  ── Quando existe um controle independente à esquerda ──

  A geometria se divide em dois: o WRAPPER carrega padding, gap e hover; o
  botão principal fica só com o preenchimento da largura restante.

  Somados, os dois reproduzem exatamente a altura e o respiro do
  `ROW_SHELL_CLASS` — uma lista com controle e outra sem precisam parecer a
  mesma coisa. O `group` mora no wrapper para o chevron reagir ao hover da
  linha inteira, incluindo a passagem sobre o círculo.
*/
const ROW_SHELL_OUTER_CLASS =
  'group flex w-full min-w-0 items-center gap-3 rounded-lg px-0 py-3.5 transition-colors hover:bg-muted/30 sm:gap-4 sm:px-2 sm:py-4'

/*
  O botão principal dentro do wrapper: sem padding vertical próprio (já veio
  de fora) e sem hover próprio (idem). Mantém o anel de foco, porque ele é
  deste controle e não da linha.
*/
/* O mesmo alvo, quando a row tem um controle independente ao lado. */
const ROW_SHELL_INNER_CLASS =
  'flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:gap-4'

export interface FinancialListRowProps {
  /**
   * Ícone/avatar NÃO interativo, dentro da área que abre o detalhe.
   *
   * Para um controle próprio no mesmo lugar, use `leadingAction`.
   */
  leading?: ReactNode
  /**
   * Controle INDEPENDENTE à esquerda, irmão da área principal.
   *
   * Dívidas e A Receber usam: o círculo de status alterna pago/pendente sem
   * abrir o detalhe. Ele fica FORA do `button` da row — aninhar um botão
   * dentro de outro é HTML inválido, quebra o teclado e foi o que fez o
   * círculo parar de responder quando a row inteira virou botão.
   *
   * Passe `leading` OU `leadingAction`: os dois ocupam a mesma posição.
   */
  leadingAction?: ReactNode
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
  /**
   * Destaque temporário de `?highlight=`.
   *
   * Aponta para a LINHA inteira: com `leadingAction` o alvo é o wrapper, não
   * o botão interno — senão o pulso pintaria só a área de texto e deixaria o
   * círculo de fora, como se ele não fizesse parte da mesma linha.
   */
  ref?: React.Ref<HTMLElement>
}

export function FinancialListRow({
  leading,
  leadingAction,
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
      {/* Com `leadingAction`, o slot vive fora deste botão. */}
      {leadingAction ? null : leading}

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

  /*
    Com um controle independente, a geometria da row passa para o WRAPPER e o
    botão principal fica sem padding próprio: os dois juntos precisam somar
    exatamente a mesma altura e o mesmo respiro de antes, ou as listas com
    controle divergiriam das sem.

    `group` fica no wrapper para o chevron continuar reagindo ao hover da
    linha inteira.
  */
  const classes = cn(
    leadingAction ? ROW_SHELL_INNER_CLASS : ROW_SHELL_CLASS,
    className,
  )

  /*
    `Link` ou `button` conforme o uso, com as MESMAS classes. O `button`
    mantém Enter/Espaço e foco de graça; o `Link` preserva as affordances de
    navegação. Reimplementar qualquer um dos dois numa `div` clicável perderia
    acessibilidade.
  */
  /* Sem controle independente, o ref é do próprio elemento clicável. */
  const refPrincipal = leadingAction
    ? undefined
    : (ref as React.Ref<HTMLButtonElement>)

  const principal = href ? (
    <Link href={href} aria-label={ariaLabel} className={classes}>
      {conteudo}
    </Link>
  ) : (
    <button
      ref={refPrincipal}
      type="button"
      onClick={onView}
      aria-label={ariaLabel}
      className={classes}
    >
      {conteudo}
    </button>
  )

  if (!leadingAction) return principal

  /*
    Dois controles IRMÃOS, com aparência de uma row só.

    O hover mora no wrapper para a linha inteira reagir junto — mas o
    controle da esquerda tem o seu próprio, então tocar nele não parece que
    vai abrir o detalhe.
  */
  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      className={cn(ROW_SHELL_OUTER_CLASS, className)}
    >
      {leadingAction}
      {principal}
    </div>
  )
}
