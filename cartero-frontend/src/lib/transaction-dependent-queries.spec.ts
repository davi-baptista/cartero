import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import {
  invalidateTransactionDependents,
  transactionAffectsPerson,
} from './transaction-dependent-queries'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O que depende de uma transação — e quem decide isso
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Duas coisas são protegidas aqui:
 *
 * 1. a política em si — quais famílias de query uma mutação de transação
 *    invalida, e quando as superfícies de pessoa entram;
 * 2. o fato de haver UMA política. Nove mutações mantinham listas próprias, e
 *    elas divergiram em cinco variações antes de alguém notar.
 */

const ler = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8')

/** Sem comentários: a prosa explica o bug e casaria com as asserções. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Coleta as chaves invalidadas, na ordem em que foram pedidas. */
function espionar() {
  const chaves: unknown[][] = []
  const qc = {
    invalidateQueries: vi.fn(({ queryKey }: { queryKey: unknown[] }) => {
      chaves.push(queryKey)
    }),
  } as unknown as QueryClient

  return {
    qc,
    chaves,
    /** As raízes pedidas, como strings comparáveis. */
    raizes: () => chaves.map((k) => k[0]),
    /** `true` se alguma chamada pediu invalidação sem filtro. */
    invalidouTudo: () =>
      (qc.invalidateQueries as unknown as { mock: { calls: unknown[][] } }).mock.calls.some(
        (args) => args.length === 0 || args[0] === undefined,
      ),
  }
}

describe('as dependências base de qualquer lançamento', () => {
  it('invalida Extrato, faturas, orçamento e cobranças', () => {
    const s = espionar()
    invalidateTransactionDependents(s.qc)

    for (const raiz of [
      'transactions',
      'bank-invoices',
      'invoices',
      'budget',
      'receivables',
    ]) {
      expect(s.raizes(), `faltou ${raiz}`).toContain(raiz)
    }
  })

  it('a fatura aberta e a do cartão entram quando o chamador as conhece', () => {
    const s = espionar()
    invalidateTransactionDependents(s.qc, { invoiceId: 'i1', bankId: 'b1' })

    expect(s.chaves).toEqual(
      expect.arrayContaining([
        ['invoice', 'i1'],
        ['bank-invoices', 'b1'],
      ]),
    )
  })

  it('sem bankId, a família inteira de bank-invoices é invalidada', () => {
    /*
      Quem cria um lançamento pelo Extrato não sabe de qual cartão a fatura
      será — o servidor decide pela data. Restringir a um `bankId` ausente
      deixaria a lista do cartão exibindo o total antigo.
    */
    const s = espionar()
    invalidateTransactionDependents(s.qc)

    expect(s.chaves).toEqual(expect.arrayContaining([['bank-invoices']]))
  })

  it('NUNCA invalida o cache inteiro', () => {
    /*
      Limpar tudo resolveria qualquer incoerência descartando o que a página
      carregou corretamente — cada edição viraria uma recarga disfarçada.
    */
    const s = espionar()
    invalidateTransactionDependents(s.qc, { affectsPerson: true })

    expect(s.invalidouTudo()).toBe(false)
    for (const chave of s.chaves) {
      expect(Array.isArray(chave) && chave.length > 0).toBe(true)
    }
  })
})

describe('as superfícies de pessoa', () => {
  it('entram quando a mutação pode ter mexido em alguém', () => {
    const s = espionar()
    invalidateTransactionDependents(s.qc, { affectsPerson: true })

    expect(s.raizes()).toContain('persons')
    expect(s.raizes()).toContain('person-statement')
  })

  it('ficam de fora numa compra própria', () => {
    /*
      Duas requisições em cada lançamento que não altera saldo de ninguém
      seriam desperdício — e este teste é o que impede alguém "simplificar"
      invalidando sempre.
    */
    const s = espionar()
    invalidateTransactionDependents(s.qc, { affectsPerson: false })

    expect(s.raizes()).not.toContain('persons')
    expect(s.raizes()).not.toContain('person-statement')
  })

  it('usa as chaves canônicas do projeto', () => {
    const s = espionar()
    invalidateTransactionDependents(s.qc, { affectsPerson: true })

    const planas = s.raizes()
    expect(planas).not.toContain('personStatement')
    expect(planas).not.toContain('person_statement')
  })

  it('invalida por PREFIXO, alcançando toda pessoa e todo período', () => {
    /*
      A chave real é `['person-statement', personId, início, fim]`. Pedir o
      prefixo cobre A e B de uma vez no caso "mover a compra de A para B" —
      montar as chaves à mão exigiria saber quais pessoas estão em cache.
    */
    const s = espionar()
    invalidateTransactionDependents(s.qc, { affectsPerson: true })

    expect(s.chaves).toEqual(
      expect.arrayContaining([['person-statement'], ['persons']]),
    )
  })
})

describe('quando a mutação mexe em alguém', () => {
  it('T2: compra nova atribuída a uma pessoa', () => {
    expect(transactionAffectsPerson(null, 'p1')).toBe(true)
  })

  it('T1: compra nova sem pessoa', () => {
    expect(transactionAffectsPerson(null, null)).toBe(false)
    expect(transactionAffectsPerson(null, undefined)).toBe(false)
  })

  it('T3: sem pessoa → pessoa A', () => {
    expect(transactionAffectsPerson(null, 'A')).toBe(true)
  })

  it('T4: pessoa A → sem pessoa (a pessoa que SAIU também muda)', () => {
    /*
      O caso que uma comparação ingênua erraria: o payload diz `null`, e quem
      precisa ser atualizada é a pessoa que já não aparece nele.
    */
    expect(transactionAffectsPerson('A', null)).toBe(true)
  })

  it('T5: pessoa A → pessoa B', () => {
    expect(transactionAffectsPerson('A', 'B')).toBe(true)
  })

  it('T6: editar valor mantendo a pessoa A', () => {
    /*
      O extrato dela soma o valor da compra — mudar o valor sem mudar o dono
      ainda muda o que ela deve. Restringir a invalidação à troca de
      `personId` deixaria esse saldo obsoleto.
    */
    expect(transactionAffectsPerson('A', 'A')).toBe(true)
    /* Nem o formulário precisa mencionar pessoa para isso valer. */
    expect(transactionAffectsPerson('A', undefined)).toBe(true)
  })
})

describe('G5: existe UMA política, não nove listas', () => {
  const consumidores = [
    ['Extrato', '../app/(dashboard)/transactions/page.tsx'],
    ['painel da fatura', '../components/invoice-details-drawer.tsx'],
    ['lista de faturas', '../app/(dashboard)/banks/[id]/invoices/page.tsx'],
    ['atalho da compra de origem', './use-delete-source-transaction.ts'],
  ] as const

  it('todo consumidor de mutação de transação chama a política', () => {
    for (const [nome, caminho] of consumidores) {
      const fonte = code(ler(caminho))
      expect(fonte, `${nome} não usa a política`).toContain(
        'invalidateTransactionDependents',
      )
    }
  })

  it('nenhum deles mantém lista manual das chaves da política', () => {
    /*
      A regressão que este teste barra é precisamente G5: alguém acrescenta
      "só mais uma" chave num `onSuccess`, e a política deixa de ser única.

      `invoice`/`bank-invoices` continuam permitidos fora dela: o painel da
      fatura invalida a própria fatura ao mudar de STATUS, que é outra
      operação (a política da O3.3).
    */
    const daPolitica = ['transactions', 'invoices', 'budget', 'receivables']

    for (const [nome, caminho] of consumidores) {
      const fonte = code(ler(caminho))
      for (const chave of daPolitica) {
        expect(
          fonte,
          `${nome} voltou a invalidar '${chave}' à mão`,
        ).not.toContain(`queryKey: ['${chave}']`)
      }
    }
  })

  it('nenhum deles invalida pessoa por conta própria', () => {
    /*
      Era assim que a divergência começava: uma mutação sabia de `persons`, a
      vizinha não, e o atalho da compra de origem sabia de `persons` mas não
      de `person-statement`.
    */
    for (const [nome, caminho] of consumidores) {
      const fonte = code(ler(caminho))
      expect(fonte, `${nome} invalida persons à mão`).not.toContain(
        "queryKey: ['persons']",
      )
      expect(fonte, `${nome} invalida person-statement à mão`).not.toContain(
        "queryKey: ['person-statement']",
      )
    }
  })

  it('a política de STATUS de fatura continua separada', () => {
    /*
      `invalidateInvoiceDependents` responde a outra pergunta — o que muda
      quando uma fatura é paga ou reaberta. Fundir as duas faria toda edição
      de lançamento arrastar dependências de status, e vice-versa.
    */
    const drawer = code(ler('../components/invoice-details-drawer.tsx'))
    expect(drawer).toContain('invalidateInvoiceDependents(qc,')
    expect(drawer).toContain('invalidateTransactionDependents(qc,')
  })
})

describe('as mutações passam a informação certa', () => {
  const EXTRATO = code(ler('../app/(dashboard)/transactions/page.tsx'))
  const FATURA = code(ler('../components/invoice-details-drawer.tsx'))
  const LISTA = code(ler('../app/(dashboard)/banks/[id]/invoices/page.tsx'))
  const ATALHO = code(ler('./use-delete-source-transaction.ts'))

  it('M1: criar deriva de personId do payload', () => {
    expect(EXTRATO).toContain(
      'transactionAffectsPerson(null, variables.personId)',
    )
    expect(FATURA).toContain(
      'transactionAffectsPerson(null, variables.personId)',
    )
    expect(LISTA).toContain(
      'transactionAffectsPerson(null, variables.personId)',
    )
  })

  it('M2-M5: editar compara o ANTES com o depois', () => {
    /*
      Sem `previousPersonId` o caso A → B ficaria pela metade: a pessoa que
      perdeu a compra não está no payload.
    */
    for (const [nome, fonte] of [
      ['Extrato', EXTRATO],
      ['painel da fatura', FATURA],
    ] as const) {
      expect(fonte, nome).toContain('variables.previousPersonId')
      expect(fonte, nome).toContain('variables.payload.personId')
    }
  })

  it('os dois call sites de edição enviam o valor anterior', () => {
    /* Um deles esquecido deixaria o caso A → B silenciosamente incompleto. */
    expect(EXTRATO).toContain('previousPersonId: editTx.personId')
    expect(EXTRATO).toContain('previousPersonId: pendingEdit.tx.personId')
    expect(FATURA).toContain('previousPersonId: editTx.personId')
    expect(FATURA).toContain('previousPersonId: pendingEdit.tx.personId')
  })

  it('M6: excluir usa o dado que já era coletado para o toast', () => {
    expect(EXTRATO).toContain('affectsPerson: Boolean(variables.hasPerson)')
  })

  it('M7: excluir parcelas usa o resultado real da execução', () => {
    expect(EXTRATO).toContain('affectsPerson: result.receivablesRemoved > 0')
    expect(FATURA).toContain('invalidateAfterTxChange(result.receivablesRemoved > 0)')
  })

  it('o atalho da compra de origem sempre afeta pessoa', () => {
    /* Ele só existe para excluir a compra que originou a cobrança de alguém. */
    expect(ATALHO).toContain('affectsPerson: true')
  })
})
