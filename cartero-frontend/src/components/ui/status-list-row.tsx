import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { DisclosureChevron } from '@/components/ui/disclosure-chevron'
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
  const classes = cn(
    'group flex w-full cursor-pointer gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30 active:bg-muted/50',
    subtitle ? 'flex-col justify-center gap-1' : 'items-center',
  )

  const conteudo = (
    <>
      <div
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg',
          toneClasses.bg,
        )}
      >
        <Icon className={cn('size-4', toneClasses.icon)} aria-hidden />
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
          <span className="truncate text-[13px] font-medium transition-colors group-hover:text-primary">
            {title}
          </span>
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

      <span
        className={cn(
          'shrink-0 text-[13px] font-semibold tabular-nums tracking-[-0.01em]',
          amountClasses.amount,
        )}
      >
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
