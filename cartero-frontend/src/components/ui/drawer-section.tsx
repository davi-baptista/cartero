import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

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
export const DRAWER_SECTION_INSET = 'px-4'

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
        DRAWER_SECTION_INSET,
        'py-6 text-center text-[11px] text-muted-foreground',
        className,
      )}
    >
      {children}
    </p>
  )
}
