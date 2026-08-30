import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Uma linguagem de lista, quatro telas
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Extrato, Bancos, Dívidas e A Receber escreviam a MESMA anatomia — avatar,
 * título, chevron, metadata, valor, metadata secundária — cada uma por conta
 * própria. E já haviam divergido no que menos se nota de perto: Extrato
 * respirava `py-3.5` com avatar de 40px, Dívidas e A Receber usavam `py-3`
 * com avatar de 32px.
 *
 * Junto com a padronização, Dívidas e A Receber deixaram de expor
 * Editar/Excluir na row. A lista identifica; o detalhe administra.
 *
 * O risco dessa mudança não é visual — é de PERMISSÃO. Mover um botão de
 * lugar não pode transformar entidade protegida em editável, e é isso que a
 * segunda metade deste arquivo vigia.
 *
 * Sem DOM na suíte: o alvo é a composição dos arquivos, como em
 * `statement-scope.spec.ts`.
 */

const ler = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8')

const PRIMITIVE = ler('../components/ui/financial-list-row.tsx')
const SHELL = ler('../components/ui/detail-drawer.tsx')

const EXTRATO = ler('../app/(dashboard)/transactions/page.tsx')
const BANCOS = ler('../app/(dashboard)/banks/page.tsx')
const DIVIDAS = ler('../app/(dashboard)/debts/page.tsx')
const RECEBER = ler('../app/(dashboard)/receivables/page.tsx')
const PESSOAS = ler('../app/(dashboard)/persons/page.tsx')
const ASSINATURAS = ler('../app/(dashboard)/subscriptions/page.tsx')
const DRAWER_ASSINATURA = ler(
  '../app/(dashboard)/subscriptions/subscription-detail-drawer.tsx',
)

const DRAWER_DIVIDA = ler('../app/(dashboard)/debts/debt-detail-drawer.tsx')
const DRAWER_RECEBER = ler(
  '../app/(dashboard)/receivables/receivable-detail-drawer.tsx',
)

/** Remove comentários: vigiamos código, não a prosa que o explica. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const LISTAS = {
  Extrato: EXTRATO,
  Bancos: BANCOS,
  Dívidas: DIVIDAS,
  'A Receber': RECEBER,
  /* Pessoas entrou ao ganhar saldo mensal na row. */
  Pessoas: PESSOAS,
  Assinaturas: ASSINATURAS,
}

describe('itens 3 e 5: uma fonte para a anatomia', () => {
  it('as quatro listas renderizam pelo mesmo primitive', () => {
    for (const [nome, fonte] of Object.entries(LISTAS)) {
      expect(fonte, `${nome} deveria usar FinancialListRow`).toContain(
        '<FinancialListRow',
      )
    }
  })

  it('nenhuma lista recria a geometria da row', () => {
    /*
      A combinação padding + gap + hover é a assinatura da row. Reescrevê-la
      numa página é exatamente como a divergência voltaria — e desta vez sem
      ninguém notar, porque as telas pareceriam iguais no dia da mudança.
    */
    const GEOMETRIA = 'py-3.5 text-left outline-none transition-colors'

    expect(PRIMITIVE).toContain(GEOMETRIA)
    for (const [nome, fonte] of Object.entries(LISTAS)) {
      expect(code(fonte), `${nome} não deveria repetir a geometria`).not.toContain(
        GEOMETRIA,
      )
    }
  })

  it('os tokens tipográficos têm uma definição só', () => {
    // Mudar o tamanho do título passa por UM lugar, não por quatro páginas.
    expect(PRIMITIVE).toContain('export const ROW_TITLE_CLASS')
    expect(PRIMITIVE).toContain('export const ROW_AMOUNT_CLASS')
    expect(PRIMITIVE).toContain('export const ROW_ICON_CLASS')

    /*
      O tamanho do valor era escrito à mão em Dívidas e A Receber. Agora as
      duas importam a constante — a string literal não pode voltar.
    */
    for (const [nome, fonte] of [
      ['Dívidas', DIVIDAS],
      ['A Receber', RECEBER],
    ] as const) {
      expect(fonte).toContain('ROW_AMOUNT_CLASS')
      expect(
        code(fonte),
        `${nome} não deveria repetir o tamanho do valor`,
      ).not.toContain("'text-[17px] font-semibold tabular-nums")
    }
  })

  it('item 4: o primitive não conhece domínio', () => {
    /*
      Ele fixa o ritmo e nada mais. Um `if (debt)` aqui dentro seria o começo
      do monólito que a tarefa proíbe.
    */
    for (const dominio of ['Debt', 'Receivable', 'Transaction', 'Bank']) {
      expect(code(PRIMITIVE)).not.toContain(dominio)
    }
  })
})

describe('o valor da row: um tamanho, uma cor', () => {
  it('o Extrato não encolhe o valor no mobile', () => {
    /*
      O bug que motivou esta rodada. `AmountDisplay` tinha uma variante
      `size="sm"` (`text-sm font-medium`) usada SÓ no bloco mobile: no
      celular — onde a lista é mais consultada — o valor do Extrato aparecia
      menor e mais fraco que o de todas as outras telas.
    */
    /*
      Mira `AmountDisplay`: `size="sm"` ainda existe no `Button` de limpar
      filtros, que é outro componente e outra escala.
    */
    const amount = code(
      EXTRATO.slice(
        EXTRATO.indexOf('function AmountDisplay'),
        EXTRATO.indexOf('function TransactionRow'),
      ),
    )

    expect(amount).not.toContain('size')
    expect(amount).not.toContain('text-sm font-medium')
    expect(amount).toContain('ROW_AMOUNT_CLASS')
  })

  it('todas as listas usam a mesma escala', () => {
    for (const [nome, fonte] of Object.entries(LISTAS)) {
      expect(fonte, `${nome} deveria usar ROW_AMOUNT_CLASS`).toContain(
        'ROW_AMOUNT_CLASS',
      )
    }
  })

  it('a cor do valor vem do token, não de classe à mão', () => {
    /*
      O Extrato pintava a entrada com `--color-income` (oklch 0.700/0.170),
      um verde mais claro e saturado que o `text-receivable` (0.600/0.150)
      das demais listas. A mesma entrada de dinheiro tinha dois verdes.

      Mira o VALOR: `text-destructive` segue legítimo em badge e aviso.
    */
    expect(PRIMITIVE).toContain('export const ROW_AMOUNT_TONE')

    /*
      Só o VALOR. `INCOME_COLOR` segue pintando o ÍCONE da receita, que tem
      fundo colorido próprio e não faz parte desta padronização.
    */
    const amount = code(
      EXTRATO.slice(
        EXTRATO.indexOf('function AmountDisplay'),
        EXTRATO.indexOf('function TransactionRow'),
      ),
    )
    expect(amount).not.toContain('INCOME_COLOR')
    expect(amount).toContain('ROW_AMOUNT_TONE')

    for (const [nome, fonte] of Object.entries(LISTAS)) {
      const usos = code(fonte).match(/ROW_AMOUNT_CLASS,\s*'[^']*'/g) ?? []
      expect(usos, `${nome} não deveria colorir o valor à mão`).toEqual([])
    }
  })
})

describe('fundo do ícone: um tom para todas as listas', () => {
  it('o token sai do Extrato e é theme-aware', () => {
    /*
      `--color-expense-bg` muda com o tema (preto a 5% no claro, branco a 5%
      no escuro). Um `bg-muted/40` mantém o mesmo cinza nos dois — foi por
      isso que o token virou classe compartilhada em vez de uma opacidade
      qualquer sobre `muted`.
    */
    expect(PRIMITIVE).toContain(
      "export const ROW_ICON_BG_CLASS = 'bg-[var(--color-expense-bg)]'",
    )
  })

  it('nenhuma lista escolhe o próprio cinza', () => {
    /*
      Eram quatro tratamentos: `bg-muted` em Pessoas, `bg-muted/40` em Bancos
      e Orçamento, `bg-muted/50` em Dívidas e A Receber. Diferenças pequenas
      demais para apontar de memória, grandes o bastante para as listas nunca
      parecerem a mesma família.

      Mira o container do ícone: `bg-muted/60` segue legítimo em badge, e
      `bg-muted/40` na ilustração de 64px do estado vazio.
    */
    for (const [nome, fonte] of Object.entries(LISTAS)) {
      const usos = code(fonte).match(/ROW_ICON_CLASS,\s*(?:ROW_ICON_BG_CLASS|'[^']*')/g) ?? []
      for (const uso of usos) {
        expect(uso, `${nome} deveria usar o token compartilhado`).toContain(
          'ROW_ICON_BG_CLASS',
        )
      }
    }
  })
})

describe('itens 14 e 22: a row não administra mais', () => {
  it('Dívidas e A Receber não têm Editar/Excluir na row', () => {
    /*
      Antes cada row carregava DUAS implementações da mesma coisa: ícones no
      hover do desktop e um `DropdownMenu` no mobile.
    */
    const rows = {
      Dívidas: DIVIDAS.slice(
        DIVIDAS.indexOf('const DebtRow'),
        DIVIDAS.indexOf('function RowSkeleton'),
      ),
      'A Receber': RECEBER.slice(
        RECEBER.indexOf('const ReceivableRow'),
        RECEBER.indexOf('function RowSkeleton'),
      ),
    }

    for (const [nome, row] of Object.entries(rows)) {
      for (const acao of ['Pencil', 'Trash2', 'DropdownMenu', 'MoreVertical']) {
        expect(row, `${nome} não deveria ter ${acao} na row`).not.toContain(acao)
      }
    }
  })

  it('itens 40 e 41: a row é um alvo único, sem controle aninhado', () => {
    /*
      A row virou `button`. O `Link` para a compra que existia dentro da row
      de A Receber saiu: âncora dentro de botão é HTML inválido, quebra
      teclado e obrigava `stopPropagation`. O link vive no drawer, em "Origem".
    */
    const row = code(
      RECEBER.slice(
        RECEBER.indexOf('const ReceivableRow'),
        RECEBER.indexOf('function RowSkeleton'),
      ),
    )

    expect(row).not.toContain('<Link')
    expect(row).not.toContain('stopPropagation')
    expect(DRAWER_RECEBER).toContain('<Link')
  })

  it('a row abre o detalhe, e só', () => {
    expect(DIVIDAS).toContain('onView={setDetailTarget}')
    expect(RECEBER).toContain('onView={setDetailTarget}')
  })
})

describe('o círculo de status é um controle independente', () => {
  const ROWS = {
    Dívidas: DIVIDAS.slice(
      DIVIDAS.indexOf('const DebtRow'),
      DIVIDAS.indexOf('function RowSkeleton'),
    ),
    'A Receber': RECEBER.slice(
      RECEBER.indexOf('const ReceivableRow'),
      RECEBER.indexOf('function RowSkeleton'),
    ),
  }

  it('itens 1 e 2: o círculo alterna o estado, sem abrir o detalhe', () => {
    /*
      A regressão: ao virar `leading`, o círculo passou a ser uma `div` DENTRO
      do botão da row. Clicar nele abria o detalhe — o controle tinha sido
      engolido pela área que o continha.
    */
    for (const [nome, row] of Object.entries(ROWS)) {
      expect(row, `${nome} deveria usar leadingAction`).toContain(
        'leadingAction={',
      )
      expect(row, `${nome} não deveria pôr o círculo dentro da row`).not.toContain(
        'leading={',
      )
    }

    expect(ROWS['Dívidas']).toContain('onTogglePaid(debt)')
    expect(ROWS['A Receber']).toContain('onToggleReceived(receivable)')
  })

  it('item 3: o controle é IRMÃO da row, nunca aninhado', () => {
    /*
      `button` dentro de `button` é HTML inválido: quebra o teclado e é
      exatamente a estrutura que causou o bug. O primitive renderiza o
      `leadingAction` fora do elemento clicável.
    */
    expect(PRIMITIVE).toContain('{leadingAction ? null : leading}')
    /* O controle e a área principal são irmãos dentro do wrapper. */
    expect(PRIMITIVE).toContain('{leadingAction}')
    expect(PRIMITIVE).toContain('{principal}')
    expect(PRIMITIVE).toContain('ROW_SHELL_OUTER_CLASS')
  })

  it('itens 6 e 9: alvo confortável e acessível por teclado', () => {
    /*
      A área de toque é o container inteiro do ícone (40/44px), não o ponto
      colorido. `button` real dá Enter/Espaço e foco de graça — uma `div`
      com `onClick` perderia os dois.
    */
    for (const [nome, row] of Object.entries(ROWS)) {
      expect(row, `${nome}: o controle deveria ser um button`).toContain(
        'type="button"',
      )
      expect(row).toContain('ROW_ICON_CLASS')
      expect(row, `${nome}: faltou foco visível`).toContain('focus-visible:ring')
      expect(row, `${nome}: faltou rótulo`).toContain('aria-label={')
    }
  })

  it('item 4: o primitive continua sem regra de domínio', () => {
    for (const dominio of ['Debt', 'Receivable', 'isPaid', 'togglePaid']) {
      expect(code(PRIMITIVE)).not.toContain(dominio)
    }
  })

  it('item 5: quem não tem controle próprio não mudou', () => {
    /*
      Extrato, Bancos, Pessoas e Assinaturas seguem passando `leading`, e o
      primitive continua tratando esse caso com um elemento clicável só.
    */
    for (const [nome, fonte] of [
      ['Extrato', EXTRATO],
      ['Bancos', BANCOS],
      ['Pessoas', PESSOAS],
      ['Assinaturas', ASSINATURAS],
    ] as const) {
      expect(fonte, `${nome} deveria seguir com leading`).toContain('leading={')
      expect(code(fonte), `${nome} não deveria ter leadingAction`).not.toContain(
        'leadingAction',
      )
    }
  })
})

describe('O1: o detalhe é um painel lateral', () => {
  it('a casca usa o Sheet canônico, não um diálogo central', () => {
    /*
      `DetailDrawer` tinha nome de gaveta e renderizava modal central: nasceu
      extraída do detalhe de Transaction e herdou dele a geometria. Conviviam
      duas linguagens — fatura abria painel lateral, dívida abria modal.
    */
    expect(SHELL).toContain("from '@/components/ui/sheet'")
    expect(SHELL).toContain('side="right"')
    expect(code(SHELL)).not.toContain('DialogContent')
  })

  it('nenhum resto do bottom sheet anterior', () => {
    /* `rounded-t-*` e `bottom-0` eram do padrão antigo. */
    for (const residuo of ['rounded-t-2xl', 'bottom-0', 'top-auto', 'max-h-[88dvh]']) {
      expect(code(SHELL), `sobrou ${residuo}`).not.toContain(residuo)
    }
  })

  it('largura de ficha compacta: md, não lg', () => {
    /*
      Invoice e Pessoa usam `lg` por listarem conteúdo. Debt, Receivable e
      Subscription são fichas — é diferença de densidade, não de padrão.
    */
    expect(SHELL).toContain('sm:max-w-md')
  })

  it('os TRÊS consumers usam a mesma casca', () => {
    for (const [nome, fonte] of [
      ['Dívida', DRAWER_DIVIDA],
      ['Cobrança', DRAWER_RECEBER],
      ['Assinatura', DRAWER_ASSINATURA],
    ] as const) {
      expect(fonte, `${nome} deveria usar DetailDrawer`).toContain(
        '<DetailDrawer',
      )
      /* Nenhum recria geometria lateral própria. */
      expect(code(fonte), `${nome} não deveria montar Sheet`).not.toContain(
        'SheetContent',
      )
      expect(code(fonte)).not.toContain('side="right"')
    }
  })

  it('item 13: um único dono do scroll', () => {
    /*
      Cabeçalho e rodapé fixos, corpo rolando. `min-h-0` é o que permite:
      sem ele o filho de um flex não encolhe abaixo do conteúdo e o scroll
      escaparia para o painel inteiro.
    */
    expect(SHELL).toContain('min-h-0 flex-1 overflow-y-auto')
  })

  it('item 12: o rodapé fica FORA da área que rola', () => {
    /*
      Com altura cheia, um rodapé dentro do corpo rolaria junto e ficaria no
      meio do vazio quando a ficha fosse curta.
    */
    expect(SHELL).toContain('footer?: ReactNode')
    expect(SHELL).toContain('{footer && <div className="shrink-0">{footer}</div>}')

    for (const fonte of [DRAWER_DIVIDA, DRAWER_RECEBER, DRAWER_ASSINATURA]) {
      expect(fonte).toContain('footer={')
    }
  })

  it('itens 10 e 11: a correção de overflow sobreviveu', () => {
    /*
      Mais altura disponível não é razão para voltar a pôr as auxiliares lado
      a lado: a largura do painel continua sendo `md`.
    */
    expect(SHELL).toContain('DETAIL_ACTION_STACK_CLASS')
    for (const fonte of [DRAWER_DIVIDA, DRAWER_RECEBER]) {
      expect(fonte).toContain('DETAIL_ACTION_STACK_CLASS')
      expect(code(fonte)).not.toContain('sm:flex-row')
    }
  })

  it('O2: Transaction também usa a casca canônica', () => {
    /*
      Era o último detalhe em modal central — e a casca compartilhada nasceu
      justamente dele: as duas eram quase idênticas (`sm:max-w-md`, header
      `px-5 py-5 pr-12`, footer com safe-area).

      A asserção é invertida em relação à de O1: agora falha se Transaction
      voltar a montar um diálogo próprio para o detalhe.
    */
    expect(EXTRATO).toContain('<DetailDrawer')
    expect(code(EXTRATO)).not.toContain('<DialogContent')
    expect(code(EXTRATO)).not.toContain("from '@/components/ui/dialog'")
  })

  it('a lógica de parcelamento NÃO subiu para a casca', () => {
    /*
      `seriesInfo` já era calculado antes do markup, então a migração foi
      estrutural: a casca continua sem saber o que é uma transação.
    */
    expect(EXTRATO).toContain('const seriesInfo')
    expect(EXTRATO).toContain("transaction.parentId ?? transaction.id")

    for (const dominio of ['seriesInfo', 'installment', 'parentId', 'invoice']) {
      expect(code(SHELL), `casca não deveria conhecer ${dominio}`).not.toContain(
        dominio,
      )
    }
  })

  it('O2.5: uma só implementação de campo, sem cópia local', () => {
    /*
      Transação mantinha um `DetailRow` local: mesma geometria, três classes
      diferentes (`text-right`, `font-medium`, `text-foreground`). Mesma casca,
      duas linguagens internas.

      Venceu a direita — é o que a maioria dos campos pede, e o que Fatura e
      Pessoa já fazem nos blocos deles. O rótulo perdeu o `font-medium`: a
      hierarquia vem da cor e da posição, e com peso ele disputava ênfase com
      o valor.
    */
    expect(SHELL).toContain("align === 'end' ? 'text-right' : 'text-left'")
    expect(SHELL).toContain("<dt className=\"text-xs text-muted-foreground\">")

    /* Nenhum detalhe recria a grade nem o markup de campo. */
    for (const [nome, fonte] of [
      ['Extrato', EXTRATO],
      ['Dívida', DRAWER_DIVIDA],
      ['Cobrança', DRAWER_RECEBER],
      ['Assinatura', DRAWER_ASSINATURA],
    ] as const) {
      expect(fonte, `${nome} deveria usar DetailRow`).toContain('<DetailRow')
      expect(code(fonte), `${nome} recriou a grade`).not.toContain(
        'grid-cols-[5.5rem',
      )
      expect(code(fonte), `${nome} recriou o campo`).not.toContain('<dt ')
    }
  })

  it('o variant de alinhamento é VISUAL, não de domínio', () => {
    /*
      `align="start"` existe para texto corrido — uma descrição de três linhas
      alinhada à direita fica com a margem esquerda irregular. A casca não
      sabe que existe descrição, só que aquele valor é longo.
    */
    expect(SHELL).toContain("align?: 'start' | 'end'")

    /*
      Mira acoplamento REAL, sobre o código sem comentários: `description` é
      prop genérica da casca (o subtítulo), e os nomes de entidade aparecem só
      na prosa que explica de onde ela veio.
    */
    const codigo = code(SHELL)
    for (const dominio of [
      'isPaid',
      'transaction.',
      'debt.',
      'receivable.',
      'subscription.',
      'installment',
    ]) {
      expect(codigo, `casca não deveria conhecer ${dominio}`).not.toContain(
        dominio,
      )
    }
  })

  it('os quatro detalhes de entidade usam a MESMA casca', () => {
    for (const [nome, fonte] of [
      ['Extrato', EXTRATO],
      ['Dívida', DRAWER_DIVIDA],
      ['Cobrança', DRAWER_RECEBER],
      ['Assinatura', DRAWER_ASSINATURA],
    ] as const) {
      expect(fonte, `${nome} deveria usar DetailDrawer`).toContain(
        '<DetailDrawer',
      )
    }
  })
})

describe('itens 13 e 14: geometria das ações do drawer', () => {
  it('todas as ações compartilham UMA definição', () => {
    /*
      Os botões traziam `h-11 flex-1 sm:h-9` inline — a altura sobrescrita,
      mas o `px-2.5` do `size` default intacto. Rótulos longos como "Alterar
      data do recebimento" ficavam espremidos enquanto "Editar" parecia
      folgado.
    */
    /*
      Mira a existência da constante, não a string exata: a geometria ainda
      vai mudar, e congelá-la aqui faria o teste falhar por um ajuste que ele
      não deveria vigiar. O que importa é ela ser única e compartilhada.
    */
    expect(SHELL).toContain('export const DETAIL_ACTION_CLASS')
    expect(SHELL).toContain('h-11')

    for (const [nome, fonte] of [
      ['Dívida', DRAWER_DIVIDA],
      ['Cobrança', DRAWER_RECEBER],
    ] as const) {
      expect(fonte, `${nome} deveria usar o token`).toContain(
        'className={DETAIL_ACTION_CLASS}',
      )
      expect(
        code(fonte),
        `${nome} não deveria repetir a geometria inline`,
      ).not.toContain('h-11 flex-1 sm:h-9')
    }
  })

  it('a altura resiste ao container em coluna', () => {
    /*
      A regressão que `px-4` sozinho não resolveu.

      `flex-1` é atalho de `flex: 1 1 0%` e inclui `flex-shrink: 1`. O
      `shrink-0` da base do Button pertence ao mesmo grupo e some no
      `tailwind-merge`. No footer auxiliar, que é `flex-col` no mobile,
      `flex-1` passa a distribuir ALTURA — e os botões encolhiam até a altura
      do conteúdo.

      `min-h-*` é o que sobrevive: não pertence ao grupo `flex` nem ao grupo
      `height`, então nenhum atalho a sobrescreve. Devolver `shrink-0` seria
      inútil — o merge o removeria de novo.
    */
    expect(SHELL).toContain('min-h-11')
    expect(SHELL).toContain('sm:min-h-9')

    /*
      É o footer em COLUNA que torna a proteção necessária — hoje pelo
      `DETAIL_ACTION_STACK_CLASS`, que empilha em qualquer largura.
    */
    expect(SHELL).toContain("DETAIL_ACTION_STACK_CLASS = 'flex-col")
    for (const fonte of [DRAWER_DIVIDA, DRAWER_RECEBER]) {
      expect(fonte).toContain('DETAIL_ACTION_STACK_CLASS')
    }
  })

  it('item 14: Debt e Receivable usam a MESMA geometria', () => {
    /*
      Uma constante, os dois drawers. Um ficar certo e o outro não é
      exatamente o modo como este bug nasceu.
    */
    const usos = (fonte: string) =>
      (fonte.match(/className=\{DETAIL_ACTION_CLASS\}/g) ?? []).length

    expect(usos(DRAWER_DIVIDA)).toBe(4)
    expect(usos(DRAWER_RECEBER)).toBe(4)
  })

  it('item 9: nenhuma escala de botão nova foi inventada', () => {
    /*
      Sem `size="sm"` nem valores mágicos: os botões usam o `size` default do
      Button e só ajustam a geometria pela constante compartilhada.
    */
    for (const fonte of [DRAWER_DIVIDA, DRAWER_RECEBER]) {
      expect(code(fonte)).not.toContain('size="sm"')
      expect(code(fonte)).not.toContain('py-[')
      expect(code(fonte)).not.toContain('min-h-[')
    }
  })

  it('as ações auxiliares ficam em UMA coluna', () => {
    /*
      O overflow que apareceu depois da correção de altura.

      `max-w-md` são 448px; menos `px-5` dos dois lados e o `gap-2`, sobram
      400px — 200px por botão em `sm:flex-row`. "Alterar data do recebimento"
      precisa de ~240px com ícone e `px-4`, e a base do Button traz
      `whitespace-nowrap`: o texto não quebra, o botão não encolhe, e o
      conteúdo empurra o modal até virar scroll horizontal.

      Uma coluna é a correção certa: comprimir fonte ou padding desfaria a
      geometria confortável recém-aprovada.
    */
    expect(SHELL).toContain(
      "export const DETAIL_ACTION_STACK_CLASS = 'flex-col gap-2'",
    )

    for (const [nome, fonte] of [
      ['Dívida', DRAWER_DIVIDA],
      ['Cobrança', DRAWER_RECEBER],
    ] as const) {
      expect(fonte, `${nome} deveria empilhar`).toContain(
        'className={DETAIL_ACTION_STACK_CLASS}',
      )
      /* O breakpoint que colocava os dois lado a lado não pode voltar. */
      expect(code(fonte), `${nome} não deveria usar sm:flex-row`).not.toContain(
        'sm:flex-row',
      )
      expect(code(fonte)).not.toContain('sm:grid-cols-2')
    }
  })

  it('o overflow NÃO foi mascarado com overflow-hidden', () => {
    /*
      O modal precisa caber naturalmente. Esconder o transbordo deixaria o
      segundo botão cortado em vez de visível.
    */
    expect(code(SHELL)).not.toContain('overflow-x-hidden')
    for (const fonte of [DRAWER_DIVIDA, DRAWER_RECEBER]) {
      expect(code(fonte)).not.toContain('overflow-hidden')
    }
  })

  it('o conteúdo longo quebra em vez de alargar o modal', () => {
    /*
      `min-w-0` deixa a coluna ENCOLHER; `break-words` a faz QUEBRAR. Sem o
      segundo, um título sem espaços teria largura intrínseca maior que o
      container — o mesmo mecanismo do overflow dos botões.
    */
    expect(SHELL).toContain('min-w-0 text-sm break-words')
    expect(SHELL).toContain('leading-relaxed text-muted-foreground break-words')
  })

  it('item 16: variant muda cor, nunca tamanho', () => {
    /*
      Marcar/desmarcar, corrigir data, editar e excluir têm cores diferentes
      e a MESMA geometria. Nenhum recebe altura própria.
    */
    for (const fonte of [DRAWER_DIVIDA, DRAWER_RECEBER]) {
      const alturas = code(fonte).match(/className="h-\d+/g) ?? []
      expect(alturas).toEqual([])
    }
  })
})

describe('itens 33 e 34: os drawers são da mesma família', () => {
  it('os três usam a mesma casca', () => {
    expect(DRAWER_DIVIDA).toContain('DetailDrawer')
    expect(DRAWER_RECEBER).toContain('DetailDrawer')
    expect(SHELL).toContain('export function DetailDrawer')
  })

  it('a casca não decide regra de domínio', () => {
    /*
      Ela renderiza o que recebe. Quem sabe se uma ação é permitida é a
      página que já detinha a regra — por isso a casca não tem como
      afrouxar uma proteção por descuido.
    */
    for (const dominio of ['Debt', 'Receivable', 'isPaid', 'transactionId']) {
      expect(code(SHELL)).not.toContain(dominio)
    }
  })

  it('o campo rótulo/valor tem uma implementação só', () => {
    expect(SHELL).toContain('export function DetailRow')
    expect(SHELL).toContain('grid grid-cols-[5.5rem_minmax(0,1fr)]')

    // Os drawers de entidade consomem; não recriam a grade.
    for (const [nome, fonte] of [
      ['Dívida', DRAWER_DIVIDA],
      ['Cobrança', DRAWER_RECEBER],
    ] as const) {
      expect(fonte).toContain('<DetailRow')
      expect(fonte, `${nome} não deveria recriar a grade`).not.toContain(
        'grid-cols-[5.5rem',
      )
    }
  })
})

/*
  ─────────────────────────────────────────────────────────────────────────
  A parte que importa: permissões
  ─────────────────────────────────────────────────────────────────────────

  Item 47. Mover o botão de lugar não pode transformar entidade protegida em
  editável ou excluível.
*/
describe('item 47: nenhuma proteção foi afrouxada', () => {
  it('O3.1: quem decide o Excluir é o resolver, não `isAutomatic`', () => {
    /*
      REGRA SUBSTITUÍDA. Antes o botão nunca aparecia para cobrança
      automática; agora uma automática simples e pendente PODE ser excluída —
      pela compra de origem, com a cascata do backend removendo as duas.

      A condição `!isAutomatic` era correta para o modelo anterior e virou
      grossa demais: ela também escondia o caso que hoje é seguro.
    */
    expect(DRAWER_RECEBER).toContain('canDeleteReceivable(policy)')
    expect(code(DRAWER_RECEBER)).not.toContain('{!isAutomatic && (')
    expect(DRAWER_RECEBER).toContain('DetailNotice')
  })

  it('itens 18 e 19: as guardas continuam nos handlers da página', () => {
    /*
      O drawer chama os MESMOS handlers que a lista usava. Nenhum caminho
      novo até o backend foi criado — se `handleDelete` deixasse de rotear
      dívida com transação vinculada para o aviso, seria aqui que quebraria.
    */
    expect(DIVIDAS).toContain('if (debt.paymentTransactionId && !debt.parentId)')
    expect(DIVIDAS).toContain('setLinkedWarningTarget(debt)')

    /*
      O predicate `transactionId || paymentTransactionId` SAIU: tratava origem
      e comprovante como a mesma coisa, e mandava cobrança automática para um
      aviso cujas duas opções o backend recusava com 409.

      A guarda continua existindo — agora no resolver canônico.
    */
    expect(RECEBER).toContain('resolveReceivableDeletePolicy(receivable)')
    expect(RECEBER).toContain('setLinkedWarningTarget(receivable)')
    expect(code(RECEBER)).not.toContain(
      'receivable.transactionId || receivable.paymentTransactionId',
    )
  })

  it('o parcelamento continua pedindo escopo antes de editar/excluir', () => {
    for (const [nome, fonte] of [
      ['Dívidas', DIVIDAS],
      ['A Receber', RECEBER],
    ] as const) {
      expect(fonte, `${nome} deveria manter o diálogo de escopo`).toContain(
        "mode: 'edit' }",
      )
      expect(fonte).toContain("mode: 'delete' }")
    }
  })

  it('itens 20 e 29: a correção de data reusa o helper e o diálogo', () => {
    /*
      Sem reimplementação: a regra de quando a ação existe (`canEditSettlementDate`)
      e o diálogo são os que já existiam.
    */
    for (const [nome, fonte] of [
      ['Dívida', DRAWER_DIVIDA],
      ['Cobrança', DRAWER_RECEBER],
    ] as const) {
      expect(fonte, `${nome} deveria consultar o helper`).toContain(
        'canEditSettlementDate(',
      )
      expect(fonte).toContain('settlementDateActionLabel(')
    }

    expect(DIVIDAS).toContain('SettlementDateDialog')
    expect(RECEBER).toContain('SettlementDateDialog')
  })

  it('item 43: nenhuma ação ficou inalcançável', () => {
    /*
      Tudo que a row oferecia continua acessível — só mudou de superfície.
      Marcar/desmarcar era o ícone de status; editar e excluir eram o hover
      e o kebab.
    */
    for (const [nome, fonte] of [
      ['Dívida', DRAWER_DIVIDA],
      ['Cobrança', DRAWER_RECEBER],
    ] as const) {
      expect(fonte, `${nome}: faltou Editar`).toContain('Editar')
      expect(fonte, `${nome}: faltou alternar pagamento`).toContain(
        'Marcar como pendente',
      )
    }

    expect(DRAWER_DIVIDA).toContain('Marcar como paga')
    expect(DRAWER_RECEBER).toContain('Marcar como recebido')
  })

  it('itens 44 e 46: agir pelo drawer fecha o drawer', () => {
    /*
      Dois overlays empilhados disputariam foco, e o de baixo continuaria
      exibindo o estado velho depois da ação — no delete, um item fantasma.
    */
    /*
      Verifica CADA handler, não a mera presença de `closeDetail` no arquivo.
      Uma asserção solta passaria com o delete quebrado desde que editar
      ainda fechasse — e o delete é justamente onde a falha vira item
      fantasma selecionado.
    */
    const handlers = {
      Dívidas: { fonte: DIVIDAS, nomes: ['handleEdit', 'handleDelete', 'handleTogglePaid'] },
      'A Receber': { fonte: RECEBER, nomes: ['handleEdit', 'handleDelete', 'handleToggleReceived'] },
    }

    for (const [tela, { fonte, nomes }] of Object.entries(handlers)) {
      expect(fonte).toContain('function closeDetail()')

      for (const handler of nomes) {
        const inicio = fonte.indexOf(`function ${handler}(`)
        expect(inicio, `${tela}: ${handler} não encontrado`).toBeGreaterThan(-1)

        /* Só o começo do corpo: `closeDetail()` é a primeira instrução. */
        const corpo = code(fonte.slice(inicio, inicio + 400))
        expect(
          corpo,
          `${tela}: ${handler} deveria fechar o detalhe antes de agir`,
        ).toContain('closeDetail()')
      }
    }
  })
})

describe('Assinaturas entrou no sistema', () => {
  it('a row usa o primitive e abre o detalhe', () => {
    expect(ASSINATURAS).toContain('<FinancialListRow')
    expect(ASSINATURAS).toContain('onView={setDetailTarget}')
  })

  it('as ações saíram da row', () => {
    /*
      A row expunha Pausar, Editar e Excluir — três ícones no hover do
      desktop MAIS um `DropdownMenu` no mobile, duas implementações da mesma
      coisa mantidas em paralelo.
    */
    const row = code(
      ASSINATURAS.slice(
        ASSINATURAS.indexOf('function SubscriptionRow'),
        ASSINATURAS.indexOf('export default function'),
      ),
    )

    for (const acao of ['Pencil', 'Trash2', 'Pause', 'DropdownMenu', 'MoreVertical']) {
      expect(row, `${acao} não deveria estar na row`).not.toContain(acao)
    }
  })

  it('o drawer usa a casca compartilhada, não uma cópia', () => {
    expect(DRAWER_ASSINATURA).toContain('DetailDrawer')
    expect(DRAWER_ASSINATURA).toContain('<DetailRow')
    expect(code(DRAWER_ASSINATURA)).not.toContain('grid-cols-[5.5rem')
  })

  it('todas as ações continuam alcançáveis', () => {
    for (const acao of ['Editar', 'Excluir', 'Pausar', 'Retomar']) {
      expect(DRAWER_ASSINATURA, `faltou ${acao}`).toContain(acao)
    }
  })

  it('agir pelo drawer fecha o drawer', () => {
    /*
      Sem isso, o ConfirmDialog de exclusão abriria sobre um detalhe que
      continuaria exibindo a assinatura recém-apagada.
    */
    /*
      Verifica CADA handler, não a contagem total: com `onOpenChange` e dois
      handlers corretos, um terceiro quebrado ainda somaria três ocorrências
      e passaria despercebido.
    */
    for (const handler of ['onEdit', 'onDelete', 'onToggle']) {
      const inicio = ASSINATURAS.indexOf(`${handler}={(s) => {`)
      expect(inicio, `${handler} não encontrado`).toBeGreaterThan(-1)

      /*
        Recorta até o FIM do handler (`}}`), não uma janela fixa: 200
        caracteres a partir de `onDelete` atravessavam para dentro de
        `onToggle`, e o teste passava lendo a chamada do vizinho.
      */
      const corpo = ASSINATURAS.slice(
        inicio,
        ASSINATURAS.indexOf('}}', inicio),
      )
      expect(corpo, `${handler} deveria fechar o detalhe`).toContain(
        'setDetailTarget(null)',
      )
    }
  })

  it('pausada não inventa data de cobrança', () => {
    /*
      `nextCharge` vem do backend, pela mesma regra que decide a geração.
      Mostrar uma data numa assinatura pausada esconderia justamente o fato
      de que a geração parou.
    */
    expect(ASSINATURAS).toContain("? 'Pausada'")
    expect(DRAWER_ASSINATURA).toContain('Sem cobranças enquanto estiver pausada')
  })
})

describe('itens 30 e 56: o que NÃO podia mudar', () => {
  it('o Extrato manteve conteúdo e ações', () => {
    // A extração de primitives não podia alterar a tela de referência.
    expect(EXTRATO).toContain('AmountDisplay')
    expect(EXTRATO).toContain('TRANSACTION_TYPE_LABELS')
    expect(EXTRATO).toContain('fatura ')
    expect(EXTRATO).toContain('a receber de ')
    expect(EXTRATO).toContain('tx.description')
  })

  it('Bancos manteve ordenação, rótulo e a ausência de auto-open', () => {
    expect(BANCOS).toContain('orderBanksByUrgency')
    expect(BANCOS).toContain('Fatura atual')
    expect(BANCOS).toContain('href={`/banks/${bank.id}/invoices`}')
    expect(BANCOS).not.toContain('invoices?invoiceId=')
  })

  it('item 12: a fatura atual mantém o destaque próprio', () => {
    /*
      A padronização é tipográfica. O card azul da fatura vigente NÃO vira
      row plana — ele comunica "é esta que importa agora".
    */
    const FATURAS = ler('../app/(dashboard)/banks/[id]/invoices/page.tsx')
    expect(FATURAS).toContain('isAtual')
    expect(FATURAS).toContain('border-primary/40')
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O3 — a família dos diálogos de decisão
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Dialog central significa UMA coisa no Cartero: decisão ou tarefa curta.
 * Painel lateral significa consultar. A distinção só se sustenta se os
 * diálogos parecerem entre si.
 */

const CONFIRM = ler('../components/ui/confirm-dialog.tsx')
const D_UNMARK = ler('../app/(dashboard)/transactions/unmark-paid-warning-dialog.tsx')
const D_LINKED = ler('../app/(dashboard)/transactions/delete-linked-warning-dialog.tsx')
const D_SCOPE = ler('../app/(dashboard)/transactions/installment-scope-dialog.tsx')
const D_MARK = ler('../app/(dashboard)/transactions/mark-as-paid-dialog.tsx')
const D_SETTLE_DATE = ler('../app/(dashboard)/transactions/settlement-date-dialog.tsx')
const D_SALARY = ler('../app/(dashboard)/budget/salary-dialog.tsx')
const D_SETTLE_PERSON = ler('../app/(dashboard)/persons/settle-person-dialog.tsx')
const D_BILLING = ler('../app/(dashboard)/banks/billing-config-dialog.tsx')

describe('O3: confirmação binária tem uma casca só', () => {
  it('o aviso de desmarcar virou adapter de ConfirmDialog', () => {
    /*
      Era uma reimplementação byte a byte: mesmo `sm:max-w-sm`, mesmo rodapé
      Cancelar/destrutivo, mesma guarda de `isPending` no `onOpenChange` e o
      mesmo spinner. Só o texto era próprio.
    */
    expect(D_UNMARK).toContain('<ConfirmDialog')
    expect(code(D_UNMARK)).not.toContain('DialogFooter')
    expect(code(D_UNMARK)).not.toContain('DialogContent')
  })

  it('o domínio ficou no adapter, não na casca', () => {
    /* `kind` decide substantivo e particípio; a casca não sabe o que é dívida. */
    expect(D_UNMARK).toContain("kind === 'debt'")

    for (const dominio of ['debt', 'receivable', 'transaction', 'installment']) {
      expect(code(CONFIRM), `casca conhece ${dominio}`).not.toContain(dominio)
    }
  })

  it('a ação destrutiva usa a variant canônica', () => {
    expect(CONFIRM).toContain("variant?: 'destructive' | 'default'")
    expect(D_UNMARK).toContain('variant="destructive"')
  })
})

describe('O3: uma geometria nomeada para os diálogos centrais', () => {
  it('as duas larguras vivem em UM lugar', () => {
    expect(CONFIRM).toContain("export const DIALOG_COMPACT_CLASS = 'sm:max-w-sm'")
    expect(CONFIRM).toContain("export const DIALOG_ROOMY_CLASS = 'sm:max-w-md'")
  })

  it('nenhum diálogo escolhe a largura no olho', () => {
    /*
      Eram sete valores escritos à mão. Já seguiam a divisão na prática —
      compacto para binário, largo para quem lista opções —, mas nada a
      nomeava, e o próximo diálogo escolheria de novo.
    */
    const DIALOGS = {
      'delete-linked': D_LINKED,
      'installment-scope': D_SCOPE,
      'mark-as-paid': D_MARK,
      'settlement-date': D_SETTLE_DATE,
      salary: D_SALARY,
      'settle-person': D_SETTLE_PERSON,
      'billing-config': D_BILLING,
    }

    for (const [nome, fonte] of Object.entries(DIALOGS)) {
      expect(fonte, `${nome} deveria usar o token`).toMatch(
        /DIALOG_(COMPACT|ROOMY)_CLASS/,
      )
      expect(
        code(fonte),
        `${nome} não deveria escrever a largura à mão`,
      ).not.toContain('className="sm:max-w-')
    }
  })
})

describe('O3: o que NÃO foi unificado, e por quê', () => {
  it('o aviso de vínculo mantém rodapé próprio: a ação primária não destrói', () => {
    /*
      Três ações, e a primária é "Manter a transação" — a que PRESERVA o
      registro do dinheiro. `ConfirmDialog` põe o botão de confirmar por
      último, então migrá-lo inverteria uma ênfase deliberada.

      Compartilha a geometria; a semântica do rodapé continua própria.
    */
    expect(D_LINKED).toContain('Manter a transação')
    expect(D_LINKED).toContain('DIALOG_ROOMY_CLASS')
  })

  it('escopo e formulários curtos mantêm corpo próprio', () => {
    /*
      Escopo lista opções; marcar-como-pago tem campos. Espremê-los em
      `ConfirmDialog` exigiria conditionals de domínio na casca — o monstro
      que o item 26 proíbe.
    */
    expect(D_SCOPE).toContain('DIALOG_ROOMY_CLASS')
    expect(D_MARK).toContain('DIALOG_COMPACT_CLASS')

    for (const fonte of [D_SCOPE, D_MARK]) {
      expect(code(fonte)).not.toContain('<ConfirmDialog')
    }
  })
})
