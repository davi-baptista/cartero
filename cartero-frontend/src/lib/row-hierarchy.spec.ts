import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A hierarquia da row: quem à esquerda, quanto à direita
 * ══════════════════════════════════════════════════════════════════════════
 *
 * As duas listas passaram a dividir o trabalho da mesma forma:
 *
 *   esquerda   quem é  +  o que acontece a seguir
 *   direita    quanto  +  qual é o estado
 *
 * Em Bancos isso significou tirar a badge de status de junto do nome — ela
 * disputava largura com o título e o chevron, e no mobile fazia "Porto Seguro"
 * truncar em "Porto Seg...". E tirar a competência do trailing, que repetia
 * "SETEMBRO 2026" em toda row logo abaixo de um seletor dizendo Setembro 2026.
 *
 * Em Pessoas significou preencher o subtexto, até então vazio, com o próximo
 * acerto.
 */

const ler = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8')
/** Sem comentários: a prosa cita o que foi removido e casaria com as buscas. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const BANKS = code(ler('../app/(dashboard)/banks/page.tsx'))
const PERSONS = code(ler('../app/(dashboard)/persons/page.tsx'))
const ROW = code(ler('../components/ui/financial-list-row.tsx'))

describe('U1-U3: Bancos liberou a linha do título', () => {
  it('U1: nenhuma badge acompanha o nome do banco', () => {
    expect(BANKS).not.toContain('titleAdornment=')
    expect(BANKS).not.toContain('INVOICE_STATUS_BADGE')
  })

  it('U2: o estado da fatura desceu para o trailing', () => {
    /*
      Removido da linha do nome, mas NÃO removido da tela. O rótulo passou a
      descrever o CICLO ("Fatura atual"/"Fatura aberta") em vez do status
      interno, que competia em cor com o prazo.
    */
    const trailing = BANKS.slice(
      BANKS.indexOf('trailing={', BANKS.indexOf('function BankRow')),
    )
    expect(trailing).toContain('BANK_TRAILING_LABEL[trailingState]')
    expect(trailing).toContain('BANK_TRAILING_TONE[trailingState]')
  })

  it('U3: a competência não se repete em cada row', () => {
    /*
      `monthLabel` continua existindo — para o `aria-label`, onde o leitor de
      tela precisa do contexto que a coluna estreita não carrega.
    */
    const trailing = BANKS.slice(
      BANKS.indexOf('trailing={', BANKS.indexOf('function BankRow')),
      BANKS.indexOf('function RowSkeleton'),
    )
    expect(trailing).not.toContain('{monthLabel}')
    expect(BANKS).toContain('aria-label')
  })
})

describe('U4-U5: a informação operacional continua', () => {
  it('U4: o prazo segue no subtexto da esquerda', () => {
    /*
      "Fecha amanhã" responde o que ACONTECE; o trailing responde o ESTADO. As
      duas coisas são diferentes, e nenhuma substitui a outra.
    */
    expect(BANKS).toContain('invoiceTimingLabel(invoice)')
  })

  it('U5: banco sem fatura diz "Sem fatura", não R$ 0,00', () => {
    expect(BANKS).toContain('BANK_TRAILING_LABEL.noInvoice')
    expect(BANKS).not.toContain('R$ 0,00')
  })
})

describe('U7: a ordenação de BANKS1.1 não foi tocada', () => {
  it('a policy de prioridade continua sendo a fonte', () => {
    /* Mover elementos visuais não pode mudar quem aparece primeiro. */
    expect(BANKS).toContain('banksForPeriod(banks ?? [], invoices, period)')
    const selecao = code(ler('./bank-invoice-selection.ts'))
    expect(selecao).toContain('MONTH_ROW_RANK')
    expect(selecao).toContain('NO_INVOICE_RANK')
  })
})

describe('Pessoas ganhou o subtexto', () => {
  it('o próximo acerto vem da policy compartilhada', () => {
    /*
      O acesso deixou de ser opcional: a row resolve o balanço ausente para um
      neutro antes de derivar qualquer coisa. E um mês resolvido troca o
      subtexto de prazo pelo de conclusão — "Receber em 12d" numa linha
      quitada afirmaria pendência inexistente.
    */
    expect(PERSONS).toContain('nextItemLabel(balance.nextItem)')
    expect(PERSONS).toContain('isNextItemOverdue(balance.nextItem)')
    expect(PERSONS).toContain('resolvido ?? nextItemLabel(')
  })

  it('o subtexto usa o slot `meta`, como Bancos', () => {
    /* Mesmo primitive, mesma posição — não um layout próprio. */
    expect(PERSONS).toContain('meta={')
    expect(ROW).toContain('{meta && <div className={ROW_META_CLASS}>{meta}</div>}')
  })

  it('sem evento, a row fica sem subtexto', () => {
    /*
      `null` renderiza nada. "Sem pendências" ocuparia a linha para não dizer
      nada, e a lista existe para ser varrida rápido.
    */
    expect(PERSONS).toContain('proximoAcerto ? (')
    expect(PERSONS).not.toContain('Sem pendências')
    expect(PERSONS).not.toContain('Tudo certo')
  })

  it('só o atraso ganha cor', () => {
    /* Pintar todos os estados transformaria a lista numa árvore de Natal. */
    expect(PERSONS).toContain("atrasado && 'text-destructive'")
  })

  it('o status do saldo continua no trailing, não vira badge', () => {
    /*
      Os rótulos saíram da page para `person-period-view`, que é agora a fonte
      única — e ganharam dois estados, porque um mês quitado conserva o valor
      e precisa dizer RECEBIDO/PAGO em vez de SEM SALDO.
    */
    expect(PERSONS).toContain('PERSON_ROW_LABEL[status]')

    const view = code(ler('./person-period-view.ts'))
    for (const rotulo of [
      'A RECEBER',
      'VOCÊ DEVE',
      'RECEBIDO',
      'PAGO',
      'SEM SALDO',
    ]) {
      expect(view).toContain(rotulo)
    }
  })
})

describe('as duas páginas usam o mesmo primitive', () => {
  it('nenhuma delas cria tipografia local', () => {
    for (const [nome, fonte] of [
      ['Bancos', BANKS],
      ['Pessoas', PERSONS],
    ] as const) {
      expect(fonte, nome).toContain('FinancialListRow')
      expect(fonte, nome).toContain('ROW_AMOUNT_CLASS')
      expect(fonte, nome).toContain('ROW_TRAILING_LABEL_CLASS')
    }
  })

  it('o kebab continua irmão da row nas duas', () => {
    /* Aninhar `button` dentro de `button` é HTML inválido e quebra teclado. */
    for (const [nome, fonte] of [
      ['Bancos', BANKS],
      ['Pessoas', PERSONS],
    ] as const) {
      expect(fonte, nome).toContain('absolute top-1/2 right-1 -translate-y-1/2')
    }
  })
})

describe('sem N+1 em Pessoas', () => {
  it('o próximo acerto vem do lote que a página já carregava', () => {
    /*
      O risco real: buscar o extrato por pessoa para descobrir a próxima
      conta, numa tela que existe justamente para não abrir pessoa por pessoa.
      O campo vem de `/persons/monthly-summary`, uma requisição para a lista
      inteira.
    */
    expect(PERSONS).toContain("queryKey: ['persons', 'monthly-summary', period]")
    expect(PERSONS).not.toContain('getPersonStatement(')
    expect(PERSONS).not.toMatch(/\.map\([\s\S]{0,200}useQuery/)
  })
})
