import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DETAIL_PARAMS,
  withDetailParam,
  withoutDetailParams,
} from './detail-navigation'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Fatura e Pessoa: os dois últimos detalhes saem do state local
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Os dois já tinham `?invoiceId=` e `?personId=` — mas como SEMENTE DE
 * CHEGADA, não como identidade. O padrão era sempre o mesmo:
 *
 *     param → efeito com guarda → setState local → o param cala.
 *
 * O sintoma: clicar numa linha não escrevia a URL (nada de link direto),
 * refresh perdia o que estava aberto, e o Voltar saía da página em vez de
 * fechar o painel.
 *
 * ── A colisão que governa esta fase ──
 *
 * `personId` significa DUAS coisas no Cartero: identidade do extrato aqui, e
 * FILTRO por contraparte em Dívidas. É por isso que a Pessoa não usa
 * `useDetailNavigation` — ver a suíte de colisão no fim deste arquivo.
 */

const ler = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8')

/** Sem comentários: a prosa explica o bug e casaria com as asserções. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const FATURAS = code(ler('../app/(dashboard)/banks/[id]/invoices/page.tsx'))
const PESSOAS = code(ler('../app/(dashboard)/persons/page.tsx'))
const DIVIDAS = code(ler('../app/(dashboard)/debts/page.tsx'))

describe('Fatura: a identidade vem da URL', () => {
  it('a linha escreve o param — não só um state local', () => {
    expect(FATURAS).toContain("useDetailNavigation('invoiceId')")
    expect(FATURAS).toContain('detail.open(id)')
  })

  it('o state que era autoridade do painel sumiu', () => {
    /*
      `selectedInvoiceId` + `detailOpen` eram a dupla que mandava. Duas
      fontes discordariam: a URL diria uma coisa, o state outra, e o refresh
      mostraria a terceira (nada).
    */
    expect(FATURAS).not.toContain('selectedInvoiceId')
    expect(FATURAS).not.toContain('setDetailOpen')
  })

  it('o efeito de chegada não abre mais o painel', () => {
    /*
      O efeito continua existindo — por outro motivo legítimo: revelar a
      seção onde a fatura está, já que a lista mostra só 3 ativas e 1 paga.
      Isso é apresentação. O que ele NÃO pode mais fazer é decidir o que
      está aberto.
    */
    expect(FATURAS).not.toMatch(/setSelectedInvoiceId\(/)
    expect(FATURAS).toContain('setHistoryExpanded(true)')
    expect(FATURAS).toContain('setActiveExpanded(true)')
  })

  it('link direto e refresh resolvem por id; o clique usa a lista', () => {
    expect(FATURAS).toContain('fetchById: getInvoice')
    expect(FATURAS).toContain('fromList: invoices?.find((i) => i.id === detail.openId)')
  })

  it('id que não resolve limpa o param', () => {
    expect(FATURAS).toContain('onNotFound: detail.close')
  })

  it('o painel é alimentado e fechado pela URL', () => {
    expect(FATURAS).toContain('invoiceId={detail.openId}')
    expect(FATURAS).toContain('open={detail.openId !== null}')
    expect(FATURAS).toContain('onOpenChange={(open) => !open && detail.close()}')
  })

  it('o painel remonta por id — é o que impede tarefa órfã', () => {
    /*
      As tarefas da fatura (reabrir, editar lançamento, escopo, confirmar
      exclusão) vivem DENTRO do drawer, que é router-agnostic e não expõe
      "tarefa aberta" para a página. Sem remontar, o Voltar tirava o
      `invoiceId` da URL, o painel fechava — e o diálogo de reabrir
      continuava sobre a lista.

      Também cobre a troca de id: uma tarefa de I1 não pode sobrar sobre I2.
    */
    expect(FATURAS).toContain("key={detail.openId ?? 'none'}")
  })
})

describe('Pessoa: a identidade vem da URL', () => {
  it('a linha escreve o param', () => {
    expect(PESSOAS).toContain('onView={() => openPerson(person.id)}')
    expect(PESSOAS).toContain("searchParams.get('personId')")
  })

  it('o state que era autoridade do extrato sumiu', () => {
    expect(PESSOAS).not.toContain('setStatementPerson')
    /* A ref que fazia o param abrir UMA vez só e depois calar. */
    expect(PESSOAS).not.toContain('openedFromUrl')
  })

  it('abrir é push, fechar é replace', () => {
    /*
      Abrir é navegação: o Voltar precisa fechar, e isso exige entrada no
      histórico. Fechar pelo X não é "voltar" — quem chegou por link direto
      não tem entrada anterior no app. E com `push` no fechar o histórico
      ficaria [lista, extrato, lista]: o Voltar logo depois reabriria a
      pessoa que o usuário acabou de dispensar.
    */
    const abrir = PESSOAS.slice(PESSOAS.indexOf('const openPerson'))
    const fechar = PESSOAS.slice(PESSOAS.indexOf('const closePerson'))

    expect(abrir.slice(0, abrir.indexOf('\n  }'))).toContain('router.push')

    /*
      Fechar usa `history.replaceState`, não `router.replace`: `/persons` é
      rota ESTÁTICA, e o Next descarta uma troca só de query sobre a mesma
      entrada de cache — a URL não mudava e o drawer ficava preso no link
      direto. A semântica de histórico é a mesma: SUBSTITUI a entrada atual,
      sem empilhar. `router.replace` sobrevive como fallback de SSR.
    */
    const corpoFechar = fechar.slice(0, fechar.indexOf('\n  }'))
    expect(corpoFechar).toContain('window.history.replaceState')
    expect(corpoFechar).not.toContain('router.push')
    /* Nem abrir nem fechar podem jogar a lista para o topo. */
    expect(PESSOAS).toContain('{ scroll: false }')
  })

  it('link direto e refresh resolvem por id; o clique usa a lista', () => {
    expect(PESSOAS).toContain('fetchById: getPerson')
    expect(PESSOAS).toContain('fromList: persons.find((p) => p.id === openPersonId)')
  })

  it('id que não resolve limpa o param', () => {
    expect(PESSOAS).toContain('onNotFound: closePerson')
  })

  it('o extrato remonta por id — impede tarefa órfã', () => {
    expect(PESSOAS).toContain("key={openPersonId ?? 'none'}")
    expect(PESSOAS).toContain('open={openPersonId !== null}')
    expect(PESSOAS).toContain('onClose={closePerson}')
  })

  it('a competência do extrato não virou identidade', () => {
    /*
      Período e identidade são perguntas diferentes: `?period=` alinha a
      competência global na chegada, `?personId=` diz quem está aberto.
      Misturá-los faria trocar de mês fechar o extrato.
    */
    expect(PESSOAS).toContain("searchParams.get('period')")
    expect(PESSOAS).toContain('urlPeriodApplied')
  })
})

describe('a colisão de personId — o teste obrigatório', () => {
  /*
    O mesmo nome, duas semânticas:

      /persons?personId=P  → identidade do extrato aberto
      /debts?personId=P    → FILTRO da lista por contraparte

    Se `personId` entrasse em `DETAIL_PARAMS`, abrir uma dívida apagaria o
    filtro — a foundation limpa todos os detail params ao abrir um detalhe.
    O usuário veria a lista inteira reaparecer sozinha ao clicar numa linha.
  */

  it('personId NÃO é detail param global', () => {
    expect(DETAIL_PARAMS).not.toContain('personId')
  })

  it('Pessoas não usa a foundation de navegação para o personId', () => {
    /*
      A rota faz navegação contextual própria — mesmo caminho que o
      Orçamento já seguia. Usar `useDetailNavigation('personId')` exigiria
      pôr o param na lista global, e é isso que não pode acontecer.
    */
    expect(PESSOAS).not.toContain("useDetailNavigation('personId')")
  })

  it('abrir uma dívida PRESERVA o filtro personId', () => {
    const comFiltro = new URLSearchParams('personId=P1&startDate=2026-08-01')
    const aberto = withDetailParam(comFiltro, 'debtId', 'D1')

    expect(aberto.get('debtId')).toBe('D1')
    expect(aberto.get('personId'), 'o filtro de Dívidas foi apagado').toBe('P1')
    expect(aberto.get('startDate')).toBe('2026-08-01')
  })

  it('fechar a dívida remove só o debtId; o filtro fica', () => {
    const aberto = new URLSearchParams('personId=P1&debtId=D1')
    const fechado = withoutDetailParams(aberto)

    expect(fechado.has('debtId')).toBe(false)
    expect(fechado.get('personId'), 'o filtro de Dívidas foi apagado').toBe('P1')
  })

  it('Dívidas continua lendo personId como filtro, não como detalhe', () => {
    expect(DIVIDAS).toContain("searchParams.get('personId')")
    expect(DIVIDAS).toContain("useDetailNavigation('debtId')")
    expect(DIVIDAS).not.toContain("useDetailNavigation('personId')")
  })
})

describe('exclusividade e params vizinhos', () => {
  it('abrir a Fatura remove outros detalhes canônicos', () => {
    const aberto = withDetailParam(
      new URLSearchParams('transactionId=T1&debtId=D1'),
      'invoiceId',
      'I1',
    )

    expect(aberto.get('invoiceId')).toBe('I1')
    expect(aberto.has('transactionId')).toBe(false)
    expect(aberto.has('debtId')).toBe(false)
  })

  it('abrir e fechar a Fatura preservam os params não-detalhe', () => {
    const original = 'period=2026-08&highlight=X1'
    const aberto = withDetailParam(new URLSearchParams(original), 'invoiceId', 'I1')
    const fechado = withoutDetailParams(aberto)

    for (const [chave, valor] of new URLSearchParams(original)) {
      expect(aberto.get(chave), `abrir perdeu ${chave}`).toBe(valor)
      expect(fechado.get(chave), `fechar perdeu ${chave}`).toBe(valor)
    }
  })
})

describe('os deep links existentes continuam valendo', () => {
  it('a Visão Geral ainda linka a fatura por invoiceId', () => {
    const overview = code(ler('../app/(dashboard)/overview/page.tsx'))
    expect(overview).toContain('invoices?invoiceId=${invoice.id}')
  })

  it('o Orçamento ainda linka a pessoa por personId', () => {
    const budget = code(ler('../app/(dashboard)/budget/page.tsx'))
    expect(budget).toContain('/persons?personId=')
  })

  it('nenhum param foi renomeado', () => {
    /* Antes semente, agora identidade — o NOME é o mesmo. */
    expect(FATURAS).toContain('invoiceId')
    expect(PESSOAS).toContain('personId')
    expect(FATURAS).not.toContain('invoiceDetailId')
    expect(PESSOAS).not.toContain('statementPersonId')
    expect(PESSOAS).not.toContain('selectedPersonId')
  })
})

describe('os primitivos continuam sem saber de rota', () => {
  it('o drawer da fatura não conhece router', () => {
    const drawer = code(ler('../components/invoice-details-drawer.tsx'))
    expect(drawer).not.toContain('useRouter')
    expect(drawer).not.toContain('useSearchParams')
  })

  it('a linha financeira continua agnóstica', () => {
    const row = code(ler('../components/ui/financial-list-row.tsx'))
    expect(row).not.toContain('useRouter')
    expect(row).not.toContain('useSearchParams')
    expect(row).not.toContain('personId')
  })
})
