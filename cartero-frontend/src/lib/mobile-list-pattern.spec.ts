import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Padrão mobile de lista — duas faixas
 * ══════════════════════════════════════════════════════════════════════════
 *
 * FAIXA 1  identidade · valor · navegação
 * FAIXA 2  UMA metadata financeira, em largura cheia
 *
 * A metadata vivia DENTRO da coluna do título, dividindo espaço com o valor
 * e a seta, e levava `truncate`. Em ~390px a coluna fica estreita e o número
 * era cortado no meio — "R$ 35…" em vez de R$ 350,46. Esconder metade de uma
 * cifra é pior que não mostrá-la: o padrão prefere OMITIR detalhe de terceiro
 * nível (disponível no drawer) a exibi-lo pela metade.
 *
 * A suíte não tem DOM, então o alvo aqui é a COMPOSIÇÃO — as decisões
 * estruturais que sustentam o padrão.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')

const ROW = ler('../components/ui/status-list-row.tsx')
/** O primitive que passou a renderizar as rows das quatro listas. */
const ROW_PRIMITIVE = ler('../components/ui/financial-list-row.tsx')
const CHEVRON = ler('../components/ui/disclosure-chevron.tsx')
const BANKS = ler('../app/(dashboard)/banks/page.tsx')
const BUDGET = ler('../app/(dashboard)/budget/page.tsx')

describe('itens 2-3: a metadata nunca corta uma cifra', () => {
  it('a metadata usa o slot canônico, sem truncate', () => {
    /*
      A faixa de largura cheia existia por UM motivo: dentro da coluna do
      título a metadata levava `truncate` e cortava valores no meio — "R$ 35…"
      em vez de R$ 350,46. Esconder metade de uma cifra é pior que não
      mostrá-la.

      O conteúdo agora é PRAZO, não cifra, e vive no mesmo slot de Bancos e
      Pessoas (`ROW_META_CLASS`) — a posição que o design system usa para
      "o que acontece temporalmente". O que continua barrado é o `truncate`
      sobre metadata financeira.
    */
    expect(ROW).toContain('ROW_META_CLASS')
    expect(ROW).not.toContain('truncate text-[11px]')
  })

  it('item 10: nenhum valor financeiro é truncado na metadata', () => {
    /*
      O `truncate` da metadata era a causa direta do "R$ 35…". Truncar o
      TÍTULO continua válido — nome longo é texto, não cifra.
    */
    expect(ROW).not.toContain('mt-0.5 truncate text-[11px]')
  })

  it('itens 44-45: sem metadata, a altura vem só do padding', () => {
    /*
      O `min-h` existia para igualar linhas com e sem faixa secundária. Sem
      metadata nas três listas, ele virou espaço reservado para nada — e a
      altura já é a mesma para todas.
    */
    expect(ROW).not.toContain('min-h-[62px]')
    expect(ROW).toContain('items-center')
  })

  it('itens 44-45: há retorno de toque, onde não existe hover', () => {
    expect(ROW).toContain('active:bg-muted/50')
  })

  it('item 41: título trunca, valor e seta não encolhem', () => {
    /*
      A propriedade vigiada é o COMPORTAMENTO sob largura apertada: o título
      cede espaço (`truncate`), o valor e a seta não (`shrink-0`).

      A escala saiu da asserção: era `text-[13px]` fixo e hoje vem de
      `ROW_TITLE_CLASS`/`ROW_AMOUNT_CLASS`, os tokens do Extrato. Congelar o
      tamanho aqui faria este teste falhar a cada ajuste do design system,
      sem que nada do que ele protege tivesse mudado.
    */
    expect(ROW).toContain('ROW_TITLE_CLASS')
    expect(ROW).toContain("cn('shrink-0', ROW_AMOUNT_CLASS)")

    const titulo = ROW_PRIMITIVE.match(/ROW_TITLE_CLASS =\s*'([^']+)'/)?.[1]
    expect(titulo).toContain('truncate')
  })
})

describe('Parte C: a row de Banco segue o padrão de Pessoas', () => {
  it('itens 25/49: a row inteira é um Link, não uma div inerte', () => {
    /*
      Antes era `<div>` sem handler: só o link "Faturas" no canto abria o
      banco. `Link` dá Enter/foco de graça.
    */
    expect(BANKS).toContain('href={`/banks/${bank.id}/invoices`}')
    expect(BANKS).not.toContain(
      'group flex items-center gap-4 border-b border-border px-1 py-4',
    )
  })

  it('o chevron fica junto do NOME', () => {
    /*
      O chevron deixou de ser escrito em cada página: ele vive dentro de
      `FinancialListRow`, sempre na linha do título e sempre depois da badge.
      A garantia migrou junto — vigiar o markup de Bancos afirmaria que a
      seta some quando ela apenas mudou de casa.
    */
    expect(BANKS).toContain('<FinancialListRow')
    expect(ROW_PRIMITIVE).toContain('<DisclosureChevron />')
  })

  it('o menu administrativo é IRMÃO da row, sem disputar a largura', () => {
    /*
      As ações de banco voltaram para a listagem: elas viviam na página do
      cartão, que deixou de ser o caminho principal quando o click passou a
      abrir a fatura direto — sem isso, editar exigiria uma rota que a
      interface não oferece mais.

      O que causou a remoção anterior continua barrado: o kebab não pode
      dividir a linha com o valor. Sobreposto em `absolute`, com `pr-10` na
      row reservando o espaço, ele não empurra nada — o mesmo arranjo de
      Pessoas.
    */
    const rowAtiva = BANKS.slice(
      BANKS.indexOf('function BankRow'),
      BANKS.indexOf('function RowSkeleton'),
    )

    expect(rowAtiva).toContain('MoreVertical')
    expect(rowAtiva).toContain('absolute top-1/2 right-1')
    expect(rowAtiva).toContain('pr-10 sm:pr-12')
  })

  it('a row abre o detalhe da fatura, sem página intermediária', () => {
    /*
      O ganho da fase: com o mês no topo, a fatura já está determinada, então
      a página do meio não tem mais o que decidir.
    */
    expect(BANKS).toContain('onOpenInvoice(invoice.id)')
    expect(BANKS).toContain("useDetailNavigation('invoiceId')")
  })

  it('item 34: sem fatura no mês, nenhum R$ 0 é inventado', () => {
    /*
      O banco continua listado — a lista é de BANCOS, e sumir com um cartão
      porque o mês não teve gasto esconderia o próprio cartão. O trailing diz
      "Sem fatura" em vez de um valor que ninguém gastou.
    */
    expect(BANKS).toContain('Sem fatura')
    expect(BANKS).toContain('invoice ? () => onOpenInvoice(invoice.id) : undefined')
  })

  it('itens 30-31: a composição financeira sai da linha do banco', () => {
    /*
      Sua parte, terceiros e prazos vivem no detalhe da fatura. Na lista eles
      punham dois números a competir com o valor principal.
    */
    expect(BANKS).not.toContain('function NearestInvoiceSplit')
  })

  it('o lápis de gerenciamento vive na página do banco', () => {
    /*
      `>` entra no banco; o lápis administra o banco já aberto. Semânticas
      distintas, ícones distintos, superfícies distintas.
    */
    const INVOICES_PAGE = ler('../app/(dashboard)/banks/[id]/invoices/page.tsx')

    expect(INVOICES_PAGE).toContain('Gerenciar ${bank.name}')
    expect(INVOICES_PAGE).toContain('Editar banco')
    expect(INVOICES_PAGE).toContain('Excluir banco')
  })
})

describe('itens 7/17/47: a lista não repete o drawer', () => {
  /**
   * Desktop E mobile: entidade, status, valor, seta. A composição vive no
   * cabeçalho (consolidado) e no drawer (detalhe) — repeti-la na linha punha
   * números a competir e dava a cada registro uma altura.
   */
  const linhasDoOrcamento = BUDGET.slice(
    BUDGET.indexOf('{visibleInvoices.map'),
    BUDGET.indexOf('Pendências anteriores'),
  )

  it('nenhuma das três listas passa `subtitle`', () => {
    expect(linhasDoOrcamento).not.toContain('subtitle=')
  })

  it('a composição da fatura saiu da linha', () => {
    expect(linhasDoOrcamento).not.toContain('Sua parte')
    expect(linhasDoOrcamento).not.toContain('de outras pessoas')
  })

  it('item 8: mas o CABEÇALHO continua consolidando', () => {
    // O dado não sumiu do produto — mudou de camada.
    expect(BUDGET).toContain('sua parte')
    expect(BUDGET).toContain('de outras pessoas')
  })

  it('item 56: o aria da pessoa carrega o que a linha não mostra', () => {
    expect(BUDGET).toContain('peopleRowAriaLabel(person, formatCurrency)')
  })

  it('itens 59-60: o vencimento original das pendências anteriores sobrevive', () => {
    /*
      `subtitle` deixou de existir — tinha geometria própria (`flex-col`, faixa
      de largura cheia) e criava duas alturas de row na mesma lista. O
      conteúdo migrou para `meta`, o slot canônico.

      O que este teste protege é o FATO, não o slot: ali o vencimento ORIGINAL
      é a razão de ser da seção, e sem ele a linha não se explica.
    */
    expect(BUDGET).not.toContain('subtitle=')
    expect(BUDGET).toContain('Venceu em {formatDate(item.dueDate)}')
  })
})

describe('Refinamento visual de Bancos', () => {
  it('itens 2/6: a badge fica no grupo do NOME', () => {
    /*
      Ela vinha DEPOIS do `flex-1` e era empurrada para o canto direito,
      lendo como elemento à parte. A badge qualifica o banco — pertence à
      identidade, não à coluna de valores.
    */
    /*
      `titleAdornment` É o grupo do nome: o primitive o renderiza entre o
      título e o chevron. Passar a badge por esse slot é a afirmação de que
      ela pertence à identidade, não à coluna de valores.
    */
    /*
      A badge de Bancos SAIU do grupo do nome: ela disputava largura com o
      título e o chevron, e no mobile fazia "Porto Seguro" truncar em "Porto
      Seg...". O estado desceu para o trailing, onde a coluna já é estreita.

      O slot continua sendo o lugar certo para adornos de identidade — o teste
      passa a vigiar que Bancos não volte a usá-lo para status.
    */
    expect(BANKS).not.toContain('titleAdornment=')
    expect(BANKS).toContain('title={bank.name}')
    expect(ROW_PRIMITIVE).toContain('{titleAdornment}')
  })

  it('item 1: as duas faixas ficam próximas, sem colapsar', () => {
    /*
      O espaçamento entre título e metadata passou a ser do primitive —
      `gap-1.5` na coluna de texto, o mesmo do Extrato. Antes cada tela
      escolhia o seu, e era exatamente assim que as listas divergiam.
    */
    expect(ROW_PRIMITIVE).toContain('flex min-w-0 flex-1 flex-col gap-1.5')
    expect(BANKS).not.toContain('flex-col justify-center gap-1 py-3')
  })

  it('item 6: o chevron é neutro, nunca azul', () => {
    /*
      O padrão foi DECIDIDO como neutro e aplicado às sete setas do app —
      Bancos, Faturas, Orçamento, Compromissos, Visão Geral, Pessoas e o
      `StatusListRow` compartilhado.

      O azul fica reservado a badge, botão primário e destaque; no chevron
      ele competia com o conteúdo.
    */
    /*
      O estilo vive num componente ÚNICO agora — antes eram dois glyphs
      (`ChevronRight` e `ArrowRight`) em quatro tamanhos e três tons, cada
      tela resolvendo por conta própria.
    */
    expect(CHEVRON).toContain(
      'text-muted-foreground/30 transition-colors group-hover:text-foreground',
    )
    expect(CHEVRON).not.toContain('group-hover:text-primary')

    /*
      Uma única definição, um único consumidor direto: o chevron é escrito
      dentro de `FinancialListRow`, e as listas o recebem por tabela.
      `StatusListRow` (Orçamento) segue usando o seu diretamente.
    */
    expect(ROW_PRIMITIVE).toContain('<DisclosureChevron />')
    expect(ROW).toContain('<DisclosureChevron />')
  })

  it('item 8: banco sem fatura no mês não ganha destaque especial', () => {
    /*
      A condição é UMA — `invoice ? … : …` —, então não há ramo capaz de
      exibir valor sem rótulo ou o contrário. O que mudou desde a versão por
      urgência: o banco continua na lista, dizendo "Sem fatura", em vez de
      perder o bloco direito inteiro. Numa visão mensal a ausência é
      informação; antes era só ruído de uma fatura que não existia agora.
    */
    expect(BANKS).toContain('invoice ? (')
    expect(BANKS).toContain('BANK_TRAILING_LABEL.noInvoice')
    /* Sem comentários: a prosa explica por que NÃO exibimos o valor zero. */
    expect(BANKS.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('R$ 0,00')
  })
})

describe('Destaque da fatura atual', () => {
  const INVOICES = ler('../app/(dashboard)/banks/[id]/invoices/page.tsx')

  it('item 1: o destaque NÃO desloca o conteúdo do grid', () => {
    /*
      O bug: `mx-1 px-3` punha o conteúdo a 16px da borda enquanto as outras
      linhas começavam a 8px — o card parecia deslocado para dentro, alinhado
      com a segunda linha do texto.

      Agora o `px-2` é comum a todas as linhas e o destaque vem de fundo,
      borda e sombra, que não movem conteúdo.
    */
    expect(INVOICES).not.toContain('px-3 shadow-md')
    expect(INVOICES).toContain('-mx-px rounded-xl border border-primary/40')
    expect(INVOICES).not.toContain('ring-1 ring-inset ring-primary/15')
  })

  it('o fundo é mais presente, mas segue translúcido', () => {
    // 12% contra os 6% anteriores: salta aos olhos sem virar bloco pesado.
    expect(INVOICES).toContain('bg-primary/[0.12]')
    expect(INVOICES).not.toContain('bg-primary px-2 py-0.5')
  })

  it('item 5: a badge "Atual" volta a ser clara e neutra', () => {
    /*
      Em azul translúcido ela se dissolvia no fundo do card — as duas badges
      viravam a mesma mancha. O contraste é o que a faz ser lida de relance.
    */
    expect(INVOICES).toContain('bg-foreground px-2 py-0.5')
    expect(INVOICES).toContain('text-background')
  })

  it('item 3: a geometria do card não depende da seleção', () => {
    /*
      A causa do flicker: a condição era `isAtual && !isSelected`, então ao
      clicar a fatura atual PERDIA raio, borda e sombra e caía no fundo
      quadrado de `statusRowBg` — o flash de outro shape por um instante.

      Agora raio, borda e recuo pertencem a `isAtual` sozinho; só o FUNDO
      reage ao clique.
    */
    /*
      Mira o CÓDIGO, não o comentário: a explicação do bug cita a condição
      antiga de propósito, para quem ler depois entender o porquê.
    */
    const semComentarios = INVOICES.replace(/\/\*[\s\S]*?\*\//g, '')

    expect(semComentarios).not.toContain('isAtual && !isSelected')
    expect(semComentarios).toContain('-mx-px rounded-xl border border-primary/40')
  })

  it('item 3: `statusRowBg` não alcança a fatura atual', () => {
    // Ele sobrescreveria o fundo translúcido e traria o visual quadrado.
    expect(INVOICES).toContain('isSelected && !isAtual ? statusRowBg')
  })

  it('item 2: a fatura atual respira acima e abaixo', () => {
    expect(INVOICES).toContain("isAtual && 'my-2'")
  })

  it('a entrelinha padrão foi RESTAURADA nas linhas de fatura', () => {
    /*
      Apertar `leading-tight` no título de 15px deixava o bloco denso demais:
      são três elementos na linha 1 e uma linha de datas abaixo. Aqui a
      leitura pede respiro — o oposto da lista principal de Bancos, onde o
      problema era estrutural (o avatar) e não tipográfico.
    */
    expect(INVOICES).not.toContain('text-[15px] font-medium leading-tight')
    expect(INVOICES).toContain('gap-y-1 gap-x-1.5')
  })
})

describe('Chevron unificado', () => {
  const TELAS = {
    bancos: ler('../app/(dashboard)/banks/page.tsx'),
    faturas: ler('../app/(dashboard)/banks/[id]/invoices/page.tsx'),
    orcamento: ler('../components/ui/status-list-row.tsx'),
    extrato: ler('../app/(dashboard)/transactions/page.tsx'),
    pessoas: ler('../app/(dashboard)/persons/page.tsx'),
    compromissos: ler('../app/(dashboard)/commitments/page.tsx'),
    overview: ler('../app/(dashboard)/overview/page.tsx'),
  }

  it('todas as listas consomem o MESMO componente', () => {
    /*
      Antes cada tela definia o seu: dois glyphs diferentes (`ChevronRight` e
      `ArrowRight`), quatro tamanhos e três tons. Uma lista dizia `>` e a
      vizinha `→` para exatamente a mesma coisa.

      Agora há duas formas de consumir, ambas com UMA definição no fim:
      diretamente, ou pelo primitive de row — que já embute o chevron. Bancos
      e Extrato passaram para o segundo caminho ao adotar `FinancialListRow`.
    */
    // Pessoas entrou no primitive ao ganhar saldo mensal na row.
    const VIA_PRIMITIVE = ['bancos', 'extrato', 'pessoas']

    for (const [nome, fonte] of Object.entries(TELAS)) {
      const alvo = VIA_PRIMITIVE.includes(nome)
        ? '<FinancialListRow'
        : '<DisclosureChevron />'
      expect(fonte, `${nome} deveria consumir o chevron canônico`).toContain(alvo)
    }

    expect(ROW_PRIMITIVE).toContain('<DisclosureChevron />')
  })

  it('nenhuma tela recria o estilo por conta própria', () => {
    // O estilo vive num lugar só; recriá-lo é como a divergência voltaria.
    for (const [nome, fonte] of Object.entries(TELAS)) {
      expect(
        fonte,
        `${nome} não deveria repetir as classes do chevron`,
      ).not.toContain('shrink-0 text-muted-foreground/30 transition-colors')
    }
  })

  it('o Extrato ganhou o chevron que não tinha', () => {
    /*
      A row já era clicável, mas nada dizia isso visualmente. Hoje o chevron
      chega pelo primitive — as três rows do Extrato (avulsa, grupo de
      parcelamento e a de Bancos) o herdam do mesmo lugar.
    */
    expect(TELAS.extrato).toContain('<FinancialListRow')
    expect(ROW_PRIMITIVE).toContain('<DisclosureChevron />')
  })
})

describe('Gerenciamento do banco mudou de superfície', () => {
  const LISTA = ler('../app/(dashboard)/banks/page.tsx')
  const PAGINA_DO_BANCO = ler(
    '../app/(dashboard)/banks/[id]/invoices/page.tsx',
  )

  const rowAtiva = LISTA.slice(
    LISTA.indexOf('function BankRow'),
    LISTA.indexOf('function RowSkeleton'),
  )

  it('item 33: a row com fatura mostra o valor e a competência', () => {
    /*
      O rótulo nomeia o MÊS exibido. "Fatura atual" era correto enquanto a
      lista só mostrava a fatura vigente; com o seletor, passou a afirmar
      "atual" sobre um período histórico.
    */
    expect(rowAtiva).toContain('<MonthInvoiceAmount')
    /*
      O trailing nomeia o CICLO, não a competência nem o status interno:
      "SETEMBRO 2026" se repetia logo abaixo de um seletor que já dizia
      Setembro 2026, e `ABERTA`/`FECHADA` competia em cor com o prazo.
    */
    expect(rowAtiva).toContain('apresentacao.statusLabel')
  })

  it('item 33: banco sem fatura não inventa valor', () => {
    /*
      Rótulo e valor vivem no MESMO slot `trailing`, sob uma única condição:
      ou o banco tem fatura do mês e mostra os dois, ou o slot diz "Sem
      fatura". Não existe ramo capaz de exibir um sem o outro, nem
      placeholder de R$ 0,00.
    */
    const trailing = rowAtiva.slice(rowAtiva.indexOf('trailing={'))
    expect(trailing).toContain('<MonthInvoiceAmount')
    expect(trailing).toContain('apresentacao.statusLabel')
    expect(trailing).toContain('BANK_TRAILING_LABEL.noInvoice')
    expect(trailing).not.toContain('formatCurrency(0)')
  })

  it('item 35: "Fatura atual" NÃO é escondida no mobile', () => {
    /*
      Estava `hidden sm:inline` porque o kebab consumia a largura à direita.
      Com ele fora, o rótulo cabe — e é na tela menor que o valor mais
      precisa dizer o que representa.

      A asserção mira a REGRA responsiva, não visibilidade de DOM.
    */
    /*
      O rótulo passou a vir de `ROW_TRAILING_LABEL_CLASS`: Pessoas e Bancos
      escreviam a mesma string de sete classes cada uma por sua conta.
    */
    expect(rowAtiva).toContain('ROW_TRAILING_LABEL_CLASS')
    expect(ROW_PRIMITIVE).toContain('ROW_TRAILING_LABEL_CLASS')
    expect(ROW_PRIMITIVE).toContain('text-[10px] uppercase')
    expect(rowAtiva).not.toContain('hidden shrink-0 text-[10px] uppercase')

    /*
      A garantia real: o primitive só esconde o bloco direito no mobile
      quando existe um `trailingCompact` para substituí-lo. Bancos não passa
      nenhum — então rótulo e valor seguem visíveis a 390px.

      É esta a asserção que falha se alguém adicionar um compacto a Bancos
      sem perceber que estaria escondendo "Fatura atual".
    */
    expect(rowAtiva).not.toContain('trailingCompact')
    expect(ROW_PRIMITIVE).toContain(
      "trailingCompact ? 'hidden sm:flex' : 'flex',",
    )
  })

  it('item 34: o lápis abre Editar e Excluir na página do banco', () => {
    expect(PAGINA_DO_BANCO).toContain('Gerenciar ${bank.name}')
    expect(PAGINA_DO_BANCO).toContain('Editar banco')
    expect(PAGINA_DO_BANCO).toContain('Excluir banco')
  })

  it('item 34: a ação destrutiva está marcada como tal', () => {
    expect(PAGINA_DO_BANCO).toContain(
      "className=\"text-destructive focus:text-destructive\"",
    )
  })

  it('item 16: a distinção arquivar × excluir foi preservada', () => {
    /*
      Com histórico o backend recusa a exclusão, então oferecer "Excluir"
      empurraria o usuário para um erro. A listagem já fazia essa distinção —
      ela foi movida, não recriada com outra regra.
    */
    expect(PAGINA_DO_BANCO).toContain('bank.canDelete === false')
    expect(PAGINA_DO_BANCO).toContain('Arquivar banco')
  })

  it('itens 15/30: formulário e confirmação são REUSADOS', () => {
    // `BankSheet` e `ConfirmDialog` ganharam um segundo consumidor.
    expect(PAGINA_DO_BANCO).toContain('<BankSheet')
    expect(PAGINA_DO_BANCO).toContain('<ConfirmDialog')
    expect(PAGINA_DO_BANCO).toContain("from '../../bank-sheet'")
  })

  it('item 17: excluir devolve o usuário para uma superfície válida', () => {
    // Ficar na página de um banco que deixou de existir prenderia a tela.
    expect(PAGINA_DO_BANCO).toContain("router.push('/banks')")
  })
})

describe('Sem flicker de ordenação em Bancos', () => {
  const LISTA = ler('../app/(dashboard)/banks/page.tsx')

  it('itens 5/21: a lista espera as DUAS queries', () => {
    /*
      A ordem depende de `banks` E `invoices`. Renderizar quando só a
      primeira chegou produzia ordem de API — todos os bancos sem
      `selection`, logo na mesma prioridade — e a lista se reorganizava
      sozinha ~1s depois.
    */
    expect(LISTA).toContain('isLoading: invoicesLoading')
    expect(LISTA).toContain('isLoading || invoicesLoading ?')
  })

  it('item 6: nenhum delay artificial foi adicionado', () => {
    // O skeleton é o mesmo; só passou a cobrir o dado que a ordem exige.
    expect(LISTA).not.toContain('setTimeout')
    expect(LISTA).not.toContain('minimumLoading')
  })

  it('itens 4/5: a ordem é derivada, sem estado intermediário', () => {
    /*
      `useMemo` a partir das duas respostas — não há `setSortedBanks` num
      efeito, que renderizaria uma vez com a ordem errada antes de corrigir.
    */
    expect(LISTA).toContain('const bankRows = useMemo(')
    expect(LISTA).not.toContain('setSortedBanks')
  })
})
