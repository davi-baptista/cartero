import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  canDeleteReceivable,
  resolveReceivableDeletePolicy,
} from './receivable-delete-policy'
import type { Receivable } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Quem decide como uma cobrança é excluída
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Antes cada superfície resolvia por conta própria com `if (transactionId)`.
 * O drawer de Pessoa oferecia Excluir para cobrança automática e o backend
 * recusava com 409 — o usuário escolhia entre duas opções e nenhuma funcionava.
 *
 * O resolver é a fonte única. Estes testes fixam os modos e, sobretudo, a
 * PRECEDÊNCIA: bloqueio permanente vem antes de bloqueio removível, para a UI
 * nunca mandar o usuário a um beco.
 */

const receivable = (over: Partial<Receivable> = {}): Receivable =>
  ({
    id: 'r1',
    userId: 'u1',
    debtorName: 'Mariana',
    title: 'Jantar dividido',
    amount: 100,
    occurredAt: '2026-08-10',
    dueDate: '2026-09-10',
    isPaid: false,
    createdAt: '2026-08-10',
    updatedAt: '2026-08-10',
    ...over,
  }) as Receivable

describe('item 70: os modos', () => {
  it('manual → exclusão direta', () => {
    expect(resolveReceivableDeletePolicy(receivable())).toEqual({
      mode: 'direct',
    })
  })

  it('manual com comprovante → aviso de vínculo', () => {
    /* O caso legítimo do `delete-linked-warning`. */
    const r = receivable({ paymentTransactionId: 'p1' })
    expect(resolveReceivableDeletePolicy(r)).toEqual({ mode: 'linked-payment' })
  })

  it('automática simples e pendente → exclui a compra de origem', () => {
    const r = receivable({ transactionId: 'tx-1' })
    expect(resolveReceivableDeletePolicy(r)).toEqual({
      mode: 'source-transaction',
      transactionId: 'tx-1',
    })
  })

  it('automática recebida → desmarcar primeiro', () => {
    /*
      Apagar a compra removeria a cobrança e deixaria a transação de
      recebimento sem origem. O backend recusa com `RECEIVABLE_ALREADY_PAID`.
    */
    const r = receivable({ transactionId: 'tx-1', isPaid: true })
    expect(resolveReceivableDeletePolicy(r)).toEqual({ mode: 'unmark-first' })
  })

  it('automática parcelada → gerenciar pela origem', () => {
    const r = receivable({ transactionId: 'tx-1', title: 'Jantar 2/10' })
    expect(resolveReceivableDeletePolicy(r)).toEqual({
      mode: 'manage-from-source',
    })
  })

  it('automática com origem travada → gerenciar pela origem', () => {
    const r = receivable({ transactionId: 'tx-1' })
    expect(
      resolveReceivableDeletePolicy(r, { sourceLocked: true }),
    ).toEqual({ mode: 'manage-from-source' })
  })

  it('O3.2: a trava vem do próprio recebível, sem precisar informar', () => {
    /*
      Antes o botão aparecia, o usuário confirmava e só então o backend
      recusava. `sourceDeleteBlockReason` chega do servidor na mesma consulta
      — nenhuma superfície precisa lembrar de passar a informação.
    */
    const r = receivable({
      transactionId: 'tx-1',
      sourceDeleteBlockReason: 'PAID_INVOICE',
    })

    expect(resolveReceivableDeletePolicy(r)).toEqual({
      mode: 'manage-from-source',
    })
    expect(canDeleteReceivable(resolveReceivableDeletePolicy(r))).toBe(false)
  })

  it('sem trava, o campo não atrapalha', () => {
    const r = receivable({ transactionId: 'tx-1', sourceDeleteBlockReason: null })
    expect(resolveReceivableDeletePolicy(r).mode).toBe('source-transaction')
  })
})

describe('item 24: a série é reconhecida sem buscar a transação', () => {
  it('a PRIMEIRA parcela conta como série, mesmo sem parentId', () => {
    /*
      A primeira parcela tem `parentId` nulo — só o sufixo do título a
      identifica. Olhar apenas `parentId` deixaria justamente ela oferecendo
      um botão que a política proíbe.
    */
    const primeira = receivable({ transactionId: 'tx-1', title: 'Jantar 1/10' })
    expect(resolveReceivableDeletePolicy(primeira)).toEqual({
      mode: 'manage-from-source',
    })
  })

  it('parcela do meio, pelo parentId', () => {
    const meio = receivable({ transactionId: 'tx-1', parentId: 'r0' })
    expect(resolveReceivableDeletePolicy(meio).mode).toBe('manage-from-source')
  })

  it('"1/1" NÃO é parcelamento', () => {
    /* Uma parcela só é uma compra à vista com sufixo. */
    const unica = receivable({ transactionId: 'tx-1', title: 'Jantar 1/1' })
    expect(resolveReceivableDeletePolicy(unica).mode).toBe('source-transaction')
  })

  it('título com número solto não vira série', () => {
    const r = receivable({ transactionId: 'tx-1', title: 'Uber 25' })
    expect(resolveReceivableDeletePolicy(r).mode).toBe('source-transaction')
  })
})

describe('item 71: precedência — nunca mandar o usuário a um beco', () => {
  it('parcelada E recebida → gerenciar pela origem, não "desmarque"', () => {
    /*
      Desmarcar não liberaria o botão aqui: a exclusão continua sendo decidida
      na compra, onde o escopo existe. Prometer o contrário seria falso.
    */
    const r = receivable({
      transactionId: 'tx-1',
      title: 'Jantar 3/10',
      isPaid: true,
    })
    expect(resolveReceivableDeletePolicy(r)).toEqual({
      mode: 'manage-from-source',
    })
  })

  it('recebida E origem travada → não promete que desmarcar resolve', () => {
    const r = receivable({ transactionId: 'tx-1', isPaid: true })
    const policy = resolveReceivableDeletePolicy(r, { sourceLocked: true })

    /*
      `unmark-first` seria uma promessa falsa: com a fatura paga, a compra
      continua inexcluível depois de desmarcar.
    */
    expect(policy.mode).not.toBe('unmark-first')
  })
})

describe('item 7: a trava permanente ganha das removíveis', () => {
  it('recebida + fatura paga → trava, não "desmarque"', () => {
    /*
      Desmarcar o recebimento não faz a compra voltar a ser deletável: a
      fatura continua paga. Prometer o contrário mandaria o usuário executar
      uma ação que não destrava nada.
    */
    const r = receivable({
      transactionId: 'tx-1',
      isPaid: true,
      sourceDeleteBlockReason: 'PAID_INVOICE',
    })

    expect(resolveReceivableDeletePolicy(r).mode).toBe('manage-from-source')
    expect(resolveReceivableDeletePolicy(r).mode).not.toBe('unmark-first')
  })

  it('parcelada + fatura paga → a copy diz a trava, não o escopo', () => {
    /*
      O modo é o mesmo (`manage-from-source`), mas o motivo exibido difere:
      "abra a compra e escolha o escopo" seria falso — lá a exclusão também
      será recusada. A copy lê `sourceDeleteBlockReason` direto.
    */
    const r = receivable({
      transactionId: 'tx-1',
      title: 'Jantar 3/10',
      sourceDeleteBlockReason: 'PAID_INVOICE',
    })

    expect(resolveReceivableDeletePolicy(r).mode).toBe('manage-from-source')
    expect(canDeleteReceivable(resolveReceivableDeletePolicy(r))).toBe(false)
  })

  it('item 5: manual sem origem nunca inventa PAID_INVOICE', () => {
    const manual = receivable()
    expect(manual.sourceDeleteBlockReason).toBeUndefined()
    expect(resolveReceivableDeletePolicy(manual).mode).toBe('direct')
  })
})

describe('itens 3 e 39: as duas relações são distintas', () => {
  it('automática recebida NUNCA cai no aviso de vínculo', () => {
    /*
      Foi exatamente o bug encontrado: `transactionId || paymentTransactionId`
      mandava cobrança automática para o warning, que oferecia duas opções
      recusadas pelo backend.
    */
    const r = receivable({
      transactionId: 'tx-1',
      paymentTransactionId: 'p1',
      isPaid: true,
    })
    expect(resolveReceivableDeletePolicy(r).mode).not.toBe('linked-payment')
  })

  it('só `paymentTransactionId` não torna a cobrança automática', () => {
    const r = receivable({ paymentTransactionId: 'p1' })
    expect(resolveReceivableDeletePolicy(r).mode).toBe('linked-payment')
  })
})

describe('quais modos oferecem o botão', () => {
  it('executáveis versus orientativos', () => {
    const executavel = [
      { mode: 'direct' },
      { mode: 'linked-payment' },
      { mode: 'source-transaction', transactionId: 'tx-1' },
    ] as const

    const orientativo = [
      { mode: 'unmark-first' },
      { mode: 'manage-from-source' },
    ] as const

    for (const p of executavel) expect(canDeleteReceivable(p)).toBe(true)
    for (const p of orientativo) expect(canDeleteReceivable(p)).toBe(false)
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════
 * As superfícies obedecem ao resolver
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A mesma cobrança precisa produzir a mesma intenção em A Receber e no extrato
 * da Pessoa. Foi a divergência entre as duas que produziu o bug original.
 */

const ler = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), 'utf-8')

const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const PAGINA = ler('../app/(dashboard)/receivables/page.tsx')
const DRAWER = ler('../app/(dashboard)/receivables/receivable-detail-drawer.tsx')
const PESSOA = ler('../components/person-statement-drawer.tsx')
const HOOK = ler('./use-delete-source-transaction.ts')

describe('itens 43 e 45: nenhuma superfície decide sozinha', () => {
  it('as duas consomem o resolver canônico', () => {
    for (const [nome, fonte] of [
      ['A Receber', PAGINA],
      ['Detalhe', DRAWER],
      ['Pessoa', PESSOA],
    ] as const) {
      expect(fonte, `${nome} deveria usar o resolver`).toContain(
        'resolveReceivableDeletePolicy',
      )
    }
  })

  it('item 41: o predicate genérico não voltou', () => {
    /*
      `transactionId || paymentTransactionId` tratava origem e comprovante
      como a mesma coisa. É a regressão exata que produziu o 409.
    */
    for (const [nome, fonte] of [
      ['A Receber', PAGINA],
      ['Pessoa', PESSOA],
    ] as const) {
      expect(
        code(fonte),
        `${nome} voltou ao predicate genérico`,
      ).not.toContain('transactionId || receivable.paymentTransactionId')
    }
  })
})

describe('itens 11, 12 e 36: a exclusão opera na compra', () => {
  it('uma requisição só, sobre a transação', () => {
    expect(HOOK).toContain('deleteTransaction(transactionId)')
    /* Nunca o endpoint da cobrança — o backend recusaria com 409. */
    expect(code(HOOK)).not.toContain('deleteReceivable')
  })

  it('item 49: reaproveita as invalidações da operação real', () => {
    for (const chave of [
      'transactions',
      'receivables',
      'bank-invoices',
      'invoices',
      'budget',
      'persons',
    ]) {
      expect(HOOK, `faltou invalidar ${chave}`).toContain(`'${chave}'`)
    }
  })

  it('itens 48 e 23: o atalho não abre escopo de parcelamento', () => {
    /*
      Só é oferecido para compra não parcelada; série se exclui pelo Extrato,
      onde o diálogo de escopo já existe.
    */
    expect(code(HOOK)).not.toContain('scope')
  })
})

describe('itens 8, 9 e 44: a confirmação diz a consequência', () => {
  it('avisa que a compra também será excluída', () => {
    for (const [nome, fonte] of [
      ['A Receber', PAGINA],
      ['Pessoa', PESSOA],
    ] as const) {
      expect(fonte, `${nome}: título`).toContain('Excluir compra e cobrança?')
      expect(fonte, `${nome}: consequência`).toContain(
        'a compra de origem também será excluída',
      )
      expect(fonte, `${nome}: CTA`).toContain(
        'confirmLabel="Excluir compra e cobrança"',
      )
    }
  })

  it('item 69: automática nunca cai no aviso de vínculo', () => {
    /*
      O aviso oferece "Manter a transação", que aqui deixaria a compra
      atribuída a alguém sem a cobrança correspondente.
    */
    expect(PAGINA).toContain("case 'source-transaction':")
    expect(PAGINA).toContain("case 'linked-payment':")
  })
})

describe('item 40: a copy antiga descrevia a cascata invertida', () => {
  it('a frase contraditória saiu', () => {
    /* "apagar só a cobrança removeria as duas" — se removia as duas, não era só. */
    expect(code(DRAWER)).not.toContain('removeria as')
  })

  it('O3.2: fatura paga tem orientação PRÓPRIA', () => {
    /*
      "abra a compra e escolha o escopo" seria falso aqui: a compra também
      não pode ser excluída. O motivo é permanente, e a copy precisa dizer
      isso em vez de mandar o usuário a um caminho sem saída.
    */
    expect(DRAWER).toContain("=== 'PAID_INVOICE'")
    expect(DRAWER).toContain('fatura já paga')
    expect(DRAWER).toContain('não pode mais ser excluída')
  })

  it('cada motivo tem a sua orientação', () => {
    /*
      O JSX quebra linha no meio das frases, então a asserção mira trechos
      que não atravessam a quebra — não a frase inteira.
    */
    expect(DRAWER).toContain('escolha o escopo da exclusão')
    expect(DRAWER).toContain('desmarque o')
    expect(DRAWER).toContain('compra parcelada')
    expect(DRAWER).toContain('compra de origem também será excluída')
  })
})
