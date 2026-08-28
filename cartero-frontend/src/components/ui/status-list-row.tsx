import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'
import {
  ROW_AMOUNT_CLASS,
  ROW_ICON_CLASS,
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

const TONE_CLASSES: Record<StatusRowTone, { bg: string; icon: string; amount: string }> = {
  // Em aberto fica neutro por design: só pago e vencido carregam cor, senão
  // toda linha da lista competiria por atenção o tempo todo.
  neutral: { bg: 'bg-muted/40', icon: 'text-muted-foreground', amount: '' },
  positive: { bg: 'bg-paid/10', icon: 'text-paid', amount: 'text-paid' },
  negative: { bg: 'bg-destructive/10', icon: 'text-destructive', amount: 'text-destructive' },
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

  Só tamanho e peso; a COR continua vindo do `tone`/`amountTone` de cada
  domínio, intocada.
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
  /**
   * Sobrescreve a cor do VALOR, sem mexer no ícone.
   *
   * Existe porque algumas listas têm dois eixos independentes. Em "Acertos
   * com pessoas" o ícone comunica urgência (existe algo vencido?) e o valor
   * comunica direção (a receber ou a pagar) — um saldo negativo dentro do
   * prazo precisa de valor vermelho com ícone neutro, e `tone` sozinho não
   * consegue expressar isso.
   *
   * Faturas não passa nada e continua com os dois eixos casados, que é o
   * comportamento correto lá: o status É a única dimensão.
   */
  amountTone?: StatusRowTone
  /**
   * Linha secundária — use com parcimônia.
   *
   * Faturas, Acertos e Bancos NÃO usam: a lista mostra entidade, status e
   * valor; a composição vive no cabeçalho e no drawer. Repeti-la na linha
   * dava a cada registro uma altura diferente.
   *
   * Sobrevive para "Pendências anteriores", onde o vencimento ORIGINAL é a
   * razão de ser da seção — sem ele a linha não se explica.
   */
  subtitle?: React.ReactNode
  title: string
  badge?: { label: string; className: string }
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
  amountTone,
  subtitle,
  title,
  badge,
  amount,
}: StatusListRowProps) {
  const toneClasses = TONE_CLASSES[tone]
  const amountClasses = TONE_CLASSES[amountTone ?? tone]

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
  const classes = cn(
    'group flex w-full cursor-pointer gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/30 active:bg-muted/50 sm:gap-4 sm:py-4',
    subtitle ? 'flex-col justify-center gap-1' : 'items-center',
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
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={STATUS_ROW_TITLE_CLASS}>{title}</span>
          {badge && (
            <span
              className={cn(
                'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                badge.className,
              )}
            >
              {badge.label}
            </span>
          )}
          {/*
            Depois da badge, na linha do título — o mesmo lugar de Bancos e
            Faturas. Antes vivia no fim da row, competindo com o valor.
          */}
          <DisclosureChevron />
        </div>
      </div>

      <span className={cn(STATUS_ROW_AMOUNT_CLASS, amountClasses.amount)}>
        {formatCurrency(amount)}
      </span>
    </>
  )

  /*
    Sem `subtitle` a linha é uma faixa só — o caso das três listas
    simplificadas. Com ele, a metadata desce para a largura cheia, fora da
    disputa com o valor e a seta.
  */
  const linha = subtitle ? (
    <>
      <div className="flex w-full items-center gap-3">{conteudo}</div>
      <p className="w-full text-[11px] leading-tight text-muted-foreground">
        {subtitle}
      </p>
    </>
  ) : (
    conteudo
  )


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
