import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Chevron de "esta linha abre"
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Affordance de navegação em linha de lista — não é botão. A ação pertence à
 * row inteira, e o `aria-label` dela já anuncia o destino; por isso o ícone é
 * sempre decorativo.
 *
 * Existiam DOIS glyphs (`ChevronRight` e `ArrowRight`) em quatro tamanhos e
 * três tons, cada tela resolvendo por conta própria. Uma lista dizia `>` e a
 * vizinha `→` para a mesma coisa.
 *
 * O padrão vem da lista de Bancos: discreto em repouso, claro no hover da
 * row. Nada de azul — ele fica reservado a badge, botão primário e destaque,
 * e no chevron competia com o conteúdo.
 *
 * `group-hover` exige que o ancestral clicável tenha a classe `group`.
 */
export function DisclosureChevron({ className }: { className?: string }) {
  return (
    <ChevronRight
      aria-hidden
      className={cn(
        'size-3.5 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-foreground',
        className,
      )}
    />
  )
}
