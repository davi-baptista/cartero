import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'
import {
  ROW_AMOUNT_CLASS,
  ROW_ICON_CLASS,
  ROW_META_CLASS,
  ROW_TITLE_CLASS,
} from '@/components/ui/financial-list-row'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/formatters'

/**
 * Papel semântico de uma linha, não sua cor final — cada tela decide a
 * paleta (fatura usa os tokens padrão, dívida pode usar outra), mas o
 * significado "isto está pago / vencido / em aberto" é sempre o mesmo.
 */
export type StatusRowTone = 'neutral' | 'positive' | 'negative'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O papel do tone encolheu: valor e ícone não carregam mais cor
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Uma fatura paga acendia QUATRO sinais de sucesso ao mesmo tempo — fundo do
 * ícone, ícone, valor e badge —, e a row inteira comunicava "resolvido" de
 * quatro maneiras redundantes. Ficava mais pesada que a mesma informação em
 * Bancos, onde só o status é verde.
 *
 * O valor é um FATO financeiro: R$ 1.940,95 é o mesmo número pago ou não. O
 * ícone diz que aquilo é uma fatura, não em que estado ela está. Quem responde
 * "isto está resolvido?" é o status no trailing — e basta ele.
 *
 * O fundo do ícone sobrevive como sinal discreto de fundo (10-40% de
 * opacidade), não como cor de texto: ele situa a linha sem competir.
 */
const TONE_CLASSES: Record<StatusRowTone, { bg: string; icon: string }> = {
  neutral: { bg: 'bg-muted/40', icon: 'text-muted-foreground' },
  positive: { bg: 'bg-paid/10', icon: 'text-muted-foreground' },
  negative: { bg: 'bg-destructive/10', icon: 'text-muted-foreground' },
}

/*
  A escala das rows do Orçamento.

  Exportadas porque a linha de "Outros gastos do mês" tem estrutura própria
  (é um `Link` de navegação, não uma row de status) mas pertence à MESMA
  lista visual — ela reescrevia estes valores à mão, e bastaria mudar um dos
  lados para as linhas do mesmo card divergirem.
*/
/*
  Título na escala do Extrato (`ROW_TITLE_CLASS`), mais o realce de hover
  próprio destas rows.

  Era `text-[13px]` fixo: dois passos abaixo do Extrato no desktop, onde a
  row tem a largura toda. O texto pequeno dentro de uma linha larga era o que
  fazia o Orçamento parecer vazio — não havia ar demais, havia conteúdo de
  menos para ocupá-lo.
*/
export const STATUS_ROW_TITLE_CLASS = cn(
  ROW_TITLE_CLASS,
  'transition-colors group-hover:text-primary',
)

/*
  Valor na escala do Extrato (`ROW_AMOUNT_CLASS`).

  Não estava no pedido — que era sobre o bloco esquerdo —, mas com o título
  em 15px um valor de 13px ficaria menor que o texto ao lado, invertendo a
  hierarquia da row: o número é a informação que se procura primeiro.

  Sem cor: o valor é um fato financeiro e permanece neutro em todos os
  estados — quem diz "isto está resolvido" é o status no trailing.
*/
export const STATUS_ROW_AMOUNT_CLASS = cn('shrink-0', ROW_AMOUNT_CLASS)

export interface StatusListRowProps {
  /**
   * Destino da navegação.
   *
   * Opcional porque a mesma linha também serve para ABRIR um drawer sobre a
   * própria página — no Orçamento, sair para Bancos ou Pessoas só para ver um
   * detalhe fazia o usuário perder a competência que estava analisando.
   * Passe `href` OU `onClick`.
   */
  href?: string
  onClick?: () => void
  /** Descrição para leitor de tela, quando o título não basta. */
  ariaLabel?: string
  icon: LucideIcon
  /** Estado da linha: pinta ícone e — por padrão — o valor. */
  tone: StatusRowTone
  title: string
  /**
   * Prazo abaixo do nome — "Fecha em 6d", "Venceu em 14/08/2026".
   *
   * A metadata secundária tinha sido removida numa fase anterior por repetir
   * o que o cabeçalho já consolidava e por dar a cada row uma altura
   * diferente. O conteúdo agora é outro: prazo, não repetição de total. É a
   * informação que responde "o que acontece temporalmente?" e que Bancos e
   * Pessoas já mostram nesta posição.
   */
  meta?: React.ReactNode
  /**
   * Estado, abaixo do valor.
   *
   * Substitui a badge ao lado do título. A badge ocupava a largura que o nome
   * precisa no mobile — "Mercado Pago [Aberta] >" disputava espaço para dizer
   * algo que cabe do lado direito, onde há uma coluna inteira livre sob o
   * valor.
   */
  trailing?: React.ReactNode
  amount: number
}

/**
 * Linha de lista com ícone tonal, título, badge de status opcional, valor e
 * seta — o layout compartilhado entre Faturas e Dívidas no Orçamento. Um
 * único lugar garante que os dois nunca voltem a divergir em cor ou espaçamento.
 */
export function StatusListRow({
  href,
  onClick,
  ariaLabel,
  icon: Icon,
  tone,
  title,
  meta,
  trailing,
  amount,
}: StatusListRowProps) {
  const toneClasses = TONE_CLASSES[tone]

  /*
    `Link` ou `button` conforme o uso, com as MESMAS classes: a linha precisa
    ser idêntica nos dois modos, e o `button` mantém Enter/Espaço e foco de
    graça — reimplementar isso numa `div` clicável perderia acessibilidade.
  */
  /*
    Faixa ÚNICA: identidade · status · valor · seta.

    A metadata secundária saiu de vez — desktop e mobile. Ela repetia na lista
    o que o cabeçalho já consolida e o drawer detalha, e cada registro ganhava
    uma altura diferente conforme o que tinha a dizer. Sem ela, as linhas
    ficam previsíveis e o nome herda o espaço.

    Sem `min-h`: a altura agora vem só do padding, e é a mesma para todas.
    `active:` dá retorno de toque no mobile, onde não existe hover.
  */
  /*
    Cadência vertical do Extrato: `py-3.5` / `sm:py-4` e `gap-3` / `sm:gap-4`.

    O `px-4` NÃO vira `px-0 sm:px-2` como lá: estas rows vivem dentro dos
    cards do Orçamento, e o respiro lateral vem da própria linha — no Extrato
    ele vem do container da página.
  */
  /*
    Uma geometria só.

    Havia duas: sem `subtitle` a row era uma faixa `items-center`; com ele
    virava `flex-col` e a metadata descia em largura cheia. Duas alturas
    diferentes na mesma lista, e o `flex-col` desalinhava o ícone.

    Agora o prazo vive na COLUNA do título — o mesmo lugar de Bancos e
    Pessoas — e uma linha com prazo tem a mesma estrutura de uma sem, só mais
    alta pelo conteúdo. `items-start` mantém ícone, texto e valor alinhados
    pelo topo quando isso acontece.
  */
  const classes = cn(
    'group flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/30 active:bg-muted/50 sm:gap-4 sm:py-4',
  )

  const conteudo = (
    <>
      {/*
        Mesmo container do Extrato (40px, 44 no desktop) e o glyph escalando
        junto. Eram 32px fixos com ícone de 16px — o bloco esquerdo inteiro
        ficava menor que o das outras listas.
      */}
      <div className={cn(ROW_ICON_CLASS, toneClasses.bg)}>
        <Icon
          className={cn('size-4.5 sm:size-5', toneClasses.icon)}
          aria-hidden
        />
      </div>

      {/*
        ── Padrão de duas faixas ──

        FAIXA 1 (`flex`): identidade + badge · valor · seta.
        FAIXA 2 (largura cheia): a metadata financeira.

        Antes a metadata vivia DENTRO da coluna do título, dividindo espaço
        com o valor e a seta, e levava `truncate`. No mobile a coluna fica
        estreita e o número era cortado no meio — "R$ 35…" em vez de
        R$ 350,46. Esconder metade de uma cifra é pior que não mostrá-la.

        Agora ela ocupa a linha inteira abaixo, fora da disputa por largura.
      */}
      {/*
        ── ESQUERDA: o que é, e o que acontece temporalmente ──

        A badge saiu daqui. Ela dizia o estado na linha do NOME, disputando a
        largura que o nome precisa no mobile — "Mercado Pago [Aberta] >" —
        para comunicar algo que cabe sob o valor, onde há coluna livre.

        No lugar dela desce o prazo, a informação que a linha não tinha: por
        que esta fatura importa AGORA.
      */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={STATUS_ROW_TITLE_CLASS}>{title}</span>
          {/* Junto do título, como em Bancos e Pessoas. */}
          <DisclosureChevron />
        </span>

        {meta && <div className={ROW_META_CLASS}>{meta}</div>}
      </div>

      {/*
        ── DIREITA: quanto, e qual é o estado ──

        Empilhados, como em Bancos e Pessoas. O valor fica neutro em todos os
        estados; o status abaixo dele é o único portador de cor.
      */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={STATUS_ROW_AMOUNT_CLASS}>{formatCurrency(amount)}</span>
        {trailing}
      </div>
    </>
  )

  /*
    Sem `subtitle` a linha é uma faixa só — o caso das três listas
    simplificadas. Com ele, a metadata desce para a largura cheia, fora da
    disputa com o valor e a seta.
  */
  const linha = conteudo

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes} aria-label={ariaLabel}>
        {linha}
      </button>
    )
  }

  return (
    <Link href={href ?? '#'} className={classes} aria-label={ariaLabel}>
      {linha}
    </Link>
  )
}
