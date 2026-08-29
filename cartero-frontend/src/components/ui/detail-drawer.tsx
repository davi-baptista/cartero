import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Casca do drawer de detalhe financeiro
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Extraída do drawer de Transaction, que já era a referência. Ela carrega
 * geometria e ritmo — largura, sheet no mobile e diálogo centrado no
 * desktop, padding, divisores, tipografia de rótulo e valor.
 *
 * NÃO é um drawer universal com condicionais por entidade. Cada domínio monta
 * o próprio corpo: Debt e Receivable têm campos, estados e restrições que não
 * se parecem com os de Transaction, e espremê-los num componente só produziria
 * exatamente o monólito que a tarefa proíbe.
 *
 * O footer recebe as ações prontas. Isso é deliberado: quem sabe se uma ação é
 * permitida é a página que já detém essa regra — a casca nunca decide, e por
 * isso não tem como afrouxar uma proteção por descuido.
 */

export function DetailDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** Linha de contexto sob o título: tipo, data, status. */
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Sheet colado embaixo no mobile, diálogo centrado no desktop — o
        polegar alcança o rodapé no celular, e no desktop o conteúdo não
        atravessa a tela inteira.
      */}
      <DialogContent className="top-auto bottom-0 left-0 max-h-[88dvh] max-w-none translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-b-none rounded-t-2xl p-0 sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl">
        {/* `pr-12` reserva o espaço do botão de fechar. */}
        <DialogHeader className="border-b border-border px-5 py-5 pr-12">
          {/* Título longo quebra em vez de alargar o diálogo. */}
          <DialogTitle className="text-lg leading-snug break-words">
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Faixa do valor principal, logo abaixo do cabeçalho.
 *
 * O valor vem pronto — a cor é semântica de cada domínio, e centralizá-la aqui
 * obrigaria a casca a conhecer estorno, atraso e quitação.
 */
export function DetailAmount({
  label,
  children,
  note,
}: {
  label: string
  children: ReactNode
  note?: ReactNode
}) {
  return (
    <div className="border-b border-border bg-muted/20 px-5 py-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1">{children}</div>
      {note && <p className="mt-1 text-[11px] text-primary">{note}</p>}
    </div>
  )
}

/** Lista de campos rótulo/valor. */
export function DetailList({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-border px-5">{children}</dl>
}

/**
 * Um campo. A coluna fixa do rótulo mantém os valores alinhados entre si —
 * com largura automática, cada linha começaria num ponto diferente.
 */
export function DetailRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      {/*
        `min-w-0` deixa a coluna ENCOLHER; `break-words` a faz QUEBRAR. Sem o
        segundo, um título sem espaços — ou uma descrição colada — teria
        largura intrínseca maior que o modal e o empurraria, que é o mesmo
        mecanismo do overflow dos botões.
      */}
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  )
}

/**
 * Geometria das ações do drawer.
 *
 * `h-11` no mobile (alvo de toque confortável), `sm:h-9` no desktop, e `px-4`
 * porque o `size` default do Button traz só `px-2.5`.
 *
 * ── Por que `min-h` e não só `h` ──
 *
 * Os botões auxiliares ficavam achatados, e a altura declarada NÃO era a
 * causa: `tailwind-merge` resolve `h-8` do variant contra `h-11` do caller
 * corretamente, e `h-11` vence.
 *
 * A causa são DUAS coisas juntas:
 *
 *   1. `flex-1` é atalho de `flex: 1 1 0%` — inclui `flex-shrink: 1`. O
 *      `shrink-0` da base do Button pertence ao mesmo grupo e é descartado
 *      por `tailwind-merge` como superado. O botão perde a proteção.
 *
 *   2. O footer auxiliar é `flex-col` no mobile. Em container de coluna,
 *      `flex-1` distribui ALTURA, não largura — e, sem `shrink-0`, os botões
 *      encolhem abaixo de `h-11` até a altura do conteúdo.
 *
 * `Editar`/`Excluir` nunca sofreram disso: vivem num footer `flex` normal,
 * onde `flex-1` distribui largura.
 *
 * `min-h-*` é a correção porque nenhum atalho de `flex` a sobrescreve — ela
 * não pertence ao grupo `flex` nem ao grupo `height`. Reintroduzir
 * `shrink-0` não funcionaria: o merge o removeria de novo.
 *
 * Só GEOMETRIA. A cor continua vindo do `variant`: destrutivo, neutro e
 * primário mudam de cor, nunca de tamanho.
 */
export const DETAIL_ACTION_CLASS =
  'h-11 min-h-11 w-full flex-1 px-4 sm:h-9 sm:min-h-9'

/**
 * Empilhamento das ações AUXILIARES — marcar/desmarcar, corrigir data.
 *
 * Uma coluna, sempre, inclusive no desktop.
 *
 * Era `flex-col gap-2 sm:flex-row`, e a partir de `sm` os dois botões
 * disputavam a largura do modal. A conta não fecha: `max-w-md` são 448px,
 * menos `px-5` dos dois lados e o `gap-2` sobram 400px — 200px por botão.
 * "Alterar data do recebimento" precisa de ~240px com o ícone e o `px-4`, e
 * a base do Button traz `whitespace-nowrap`: o texto não quebra, o botão não
 * encolhe, e o conteúdo empurra o modal até aparecer scroll horizontal.
 *
 * Poderia caber comprimindo fonte ou padding — mas isso desfaria a geometria
 * confortável recém-corrigida. Rótulos desta altura simplesmente não cabem
 * lado a lado aqui, e a decisão segue a largura REAL do container, não o
 * breakpoint.
 *
 * As ações do rodapé principal (Editar/Excluir) continuam lado a lado: são
 * rótulos curtos, e nunca estouraram.
 */
export const DETAIL_ACTION_STACK_CLASS = 'flex-col gap-2'

/**
 * Rodapé de ações.
 *
 * Renderiza apenas o que recebe. Uma entidade protegida simplesmente não
 * passa a ação — nada aqui a "reabilita" por consistência visual.
 */
export function DetailFooter({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex gap-2 border-t border-border px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * Aviso dentro do drawer: explica por que uma ação não está sendo oferecida.
 *
 * Sem ele, um drawer com o rodapé vazio pareceria quebrado — o usuário veria
 * a ausência do botão sem saber que é regra, não falha.
 */
export function DetailNotice({ children }: { children: ReactNode }) {
  return (
    <div className="border-t border-border bg-muted/20 px-5 py-3">
      {/* Quebra naturalmente: o aviso não pode definir a largura do modal. */}
      <p className="text-[11px] leading-relaxed text-muted-foreground break-words">
        {children}
      </p>
    </div>
  )
}
