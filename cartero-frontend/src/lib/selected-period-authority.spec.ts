import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { addMonths, currentPeriod, periodFromDate } from '@/components/month-nav'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Quem decide o mês que o usuário está vendo
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Duas perguntas diferentes, que estavam se misturando:
 *
 *   A) COMPETÊNCIA SELECIONADA — "qual mês eu estou olhando?"
 *   B) MEMBERSHIP FINANCEIRO   — "quais itens pertencem a este mês?"
 *
 * (B) nunca pode responder (A). O Orçamento consultava `GET /budget/focus`
 * para descobrir o mês "mais relevante" e aplicava a resposta ao filtro: o
 * conteúdo financeiro escolhia a competência, e o usuário via a tela trocar
 * de mês sozinha depois que os dados chegavam.
 *
 * A suíte não tem DOM, então parte destes testes olha a COMPOSIÇÃO dos
 * arquivos — o mesmo recurso de `statement-scope.spec.ts`.
 */

const BUDGET = readFileSync(
  new URL('../app/(dashboard)/budget/page.tsx', import.meta.url),
  'utf-8',
)

const BUDGET_SERVICE = readFileSync(
  new URL('../services/budget.service.ts', import.meta.url),
  'utf-8',
)

const BANKS = readFileSync(
  new URL('../app/(dashboard)/banks/page.tsx', import.meta.url),
  'utf-8',
)

const MONTH_NAV = readFileSync(
  new URL('../components/month-nav.tsx', import.meta.url),
  'utf-8',
)

/** Remove comentários: a intenção é vigiar CÓDIGO, não a prosa que o explica. */
function code(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const BUDGET_CODE = code(BUDGET)

describe('itens 13, 14 e 36: o Orçamento não escolhe o mês', () => {
  it('a query de foco não existe mais', () => {
    /*
      Era ela que trazia a resposta "este outro mês é mais relevante".
      Sem consumidor, não há o que aplicar ao filtro.
    */
    expect(BUDGET_CODE).not.toContain('getBudgetFocus')
    expect(BUDGET_CODE).not.toContain("'focus'")
    expect(BUDGET_CODE).not.toContain('/budget/focus')
  })

  it('o cliente não expõe mais o endpoint de foco', () => {
    // O endpoint segue vivo no backend; o que saiu foi a porta de entrada
    // no frontend, para ninguém religar o salto por engano.
    expect(code(BUDGET_SERVICE)).not.toContain('getBudgetFocus')
  })

  it('a página não escreve no período — só lê', () => {
    /*
      `setPeriod` é a única forma de trocar a competência a partir daqui.
      Sem ele, nenhum caminho desta tela consegue reposicionar o filtro.
    */
    expect(BUDGET_CODE).toContain('const { period } = useMonthPeriod()')
    expect(BUDGET_CODE).not.toContain('setPeriod')
  })

  it('itens 17 e 22: não há effect capaz de dar snap-back', () => {
    /*
      O salto antigo saía de um `useEffect` com `setTimeout(..., 0)` — o
      atraso o fazia acontecer já com a tela montada, que é justamente o que
      o usuário percebia como troca silenciosa.
    */
    expect(BUDGET_CODE).not.toContain('useEffect')
    expect(BUDGET_CODE).not.toContain('setTimeout')
    expect(BUDGET_CODE).not.toContain('focusApplied')
  })

  it('itens 15 e 26: o fallback NÃO é duplicado nesta página', () => {
    /*
      O Provider já inicializa em `currentPeriod()`, uma vez, no mount.
      Repetir a inicialização aqui recriaria o auto-reset por outro caminho:
      todo render que reavaliasse o fallback poderia devolver o usuário para
      o mês civil depois de ele ter navegado.
    */
    expect(BUDGET_CODE).not.toContain('currentPeriod')
    /*
      `initialPeriod={{ month, year }}` continua existindo como PROP de
      drawer: ele recebe a competência já selecionada, que é o contrário de
      escolher uma. O que não pode voltar é o state local homônimo
      (`const [initialPeriod] = useState(currentPeriod)`), usado como
      referência para decidir se o salto era permitido.
    */
    expect(BUDGET_CODE).not.toContain('useState(currentPeriod)')
  })

  it('item 19: o resultado da API não realimenta a competência', () => {
    /*
      O ciclo proibido é: busca → analisa resposta → decide outro mês →
      troca o filtro → busca de novo. A query só depende de month/year.
    */
    const chave = BUDGET_CODE.slice(
      BUDGET_CODE.indexOf("queryKey: ['budget'"),
      BUDGET_CODE.indexOf("queryKey: ['budget'") + 120,
    )
    expect(chave).toContain('{ month, year }')
  })
})

describe('itens 25 e 31: navegar em drawer não mexe no mês', () => {
  it('os router calls existentes são de drawer, não de competência', () => {
    /*
      `personId` e `invoiceId` viajam na URL para o Back fechar o drawer.
      Nenhum desses caminhos toca month/year — se um dia tocar, o teste
      acima (`not.toContain('setPeriod')`) falha.
    */
    expect(BUDGET_CODE).toContain('personId')
    expect(BUDGET_CODE).toContain('invoiceId')

    /*
      `&period=` aparece uma vez, no link que SAI para `/persons` levando a
      competência atual — propagar o mês ao mudar de tela é o comportamento
      desejado, não o salto que estamos removendo.

      O que nenhum `router.push`/`replace` desta página pode fazer é
      reescrever a própria URL do Orçamento com outro mês.
    */
    for (const call of BUDGET_CODE.match(/router\.(push|replace)\([^)]*\)/g) ?? []) {
      expect(call).not.toContain('period')
      expect(call).not.toContain('month')
      expect(call).not.toContain('year')
    }
  })
})

describe('itens 16, 18 e 24: a fonte canônica da competência', () => {
  it('é o contexto global, compartilhado entre as telas', () => {
    // Um único estado; o Orçamento não mantém cópia paralela (item 47).
    expect(code(MONTH_NAV)).toContain('MonthPeriodContext')
    expect(code(MONTH_NAV)).toContain('useState<MonthPeriod>(currentPeriod)')
  })

  it('item 29: o fallback resolve o mês civil, não UTC cru', () => {
    /*
      `currentPeriod` usa getMonth/getFullYear — componentes do calendário
      LOCAL. `getUTCMonth` viraria o mês cedo demais em fuso negativo: às
      21h de 31/08 em Fortaleza o UTC já é 01/09, e o Orçamento abriria em
      setembro enquanto o usuário ainda vive agosto.
    */
    const fn = code(MONTH_NAV).slice(
      code(MONTH_NAV).indexOf('export function currentPeriod'),
      code(MONTH_NAV).indexOf('export function periodFromDate'),
    )
    expect(fn).toContain('getMonth()')
    expect(fn).toContain('getFullYear()')
    expect(fn).not.toContain('getUTC')
    expect(fn).not.toContain('toISOString')
  })

  it('o mês civil resolvido bate com o relógio local', () => {
    const agora = new Date()
    expect(currentPeriod()).toEqual({
      month: agora.getMonth() + 1,
      year: agora.getFullYear(),
    })
  })
})

describe('item 23: navegação manual atravessa a virada de ano', () => {
  it('avança de dezembro para janeiro', () => {
    expect(addMonths({ month: 12, year: 2026 }, 1)).toEqual({
      month: 1,
      year: 2027,
    })
  })

  it('volta de janeiro para dezembro', () => {
    expect(addMonths({ month: 1, year: 2026 }, -1)).toEqual({
      month: 12,
      year: 2025,
    })
  })

  it('a competência de uma data vem da string, sem passar por Date', () => {
    /*
      `periodFromDate` fatia a ISO. Construir um `Date` a partir dela
      interpretaria como UTC e, em fuso negativo, devolveria o mês anterior
      para todo dia 1º.
    */
    expect(periodFromDate('2026-09-01T00:00:00.000Z')).toEqual({
      month: 9,
      year: 2026,
    })
  })
})

describe('itens 1, 7 e 48: entrar no banco não abre fatura', () => {
  it('a row do banco navega para a página, sem invoiceId', () => {
    expect(code(BANKS)).toContain('href={`/banks/${bank.id}/invoices`}')
    expect(code(BANKS)).not.toContain('invoices?invoiceId=')
  })

  it('itens 3, 49 e 56: o destaque da fatura atual permanece', () => {
    /*
      Remover o auto-open não pode remover o CURRENT INVOICE HIGHLIGHT.
      `nearest` continua alimentando badge, valor e texto temporal — e
      segue sendo a base da ordenação por urgência.
    */
    const banksCode = code(BANKS)
    expect(banksCode).toContain('<NearestInvoiceBadge info={nearest} />')
    expect(banksCode).toContain('<NearestInvoiceAmount info={nearest} />')
    expect(banksCode).toContain('formatCloseTiming')
    expect(banksCode).toContain('formatDueTiming')
    expect(banksCode).toContain('orderBanksByUrgency')
  })

  it('item 11: banco sem fatura não ganha invoiceId inventado', () => {
    /*
      O href passou a ser único para os dois casos, então não existe mais
      ramo capaz de produzir um id — nem verdadeiro, nem falso.
    */
    expect(code(BANKS)).not.toContain('nearest.invoice.id')
  })
})

describe('itens 8 e 52: o deep link explícito continua suportado', () => {
  it('a página de faturas ainda lê o parâmetro', () => {
    /*
      A mudança foi só parar de INJETAR o param na origem. Quem chega por
      uma URL que já o contém continua com o drawer aberto — inclusive
      após refresh (item 53), porque a leitura vem da URL, não de state.

      A O4.3 REFORÇOU esse contrato: o param deixou de ser semente copiada
      para um `selectedInvoiceId` local e virou a própria identidade do
      painel. Por isso a asserção mudou de `setSelectedInvoiceId(param)`
      para o hook de navegação — o deep link continua honrado, agora sem a
      segunda fonte de verdade que o abria uma vez só.
    */
    const invoices = code(
      readFileSync(
        new URL('../app/(dashboard)/banks/[id]/invoices/page.tsx', import.meta.url),
        'utf-8',
      ),
    )
    expect(invoices).toContain("useDetailNavigation('invoiceId')")
    /* E não voltou a existir state local como autoridade do painel. */
    expect(invoices).not.toContain('setSelectedInvoiceId')
  })
})
