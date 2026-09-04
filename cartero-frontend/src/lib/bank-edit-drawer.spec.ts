import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  getInvoiceCloseDate,
  getInvoiceDueDate,
} from './invoice-dates'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O editor de banco tem UMA implementação e DUAS entradas
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O `Editar` do menu de `/banks` não fazia nada. `BankSheet` é controlado por
 * `sheetOpen`, e o handler só chamava `setEditBank(bank)`: o alvo era
 * definido, o drawer nunca abria. Editar um cartão exigia entrar em "Ver
 * todas as faturas" e achar o lápis.
 *
 * O editor já era compartilhado — as duas superfícies importam o mesmo
 * `BankSheet`. O que faltava era uma linha, e um teste que provasse a
 * abertura em vez da string do handler.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const SHEET = semComentarios(ler('../app/(dashboard)/banks/bank-sheet.tsx'))
const BANKS = semComentarios(ler('../app/(dashboard)/banks/page.tsx'))
const ROTA_CARTAO = semComentarios(
  ler('../app/(dashboard)/banks/[id]/invoices/page.tsx'),
)

describe('F1-F5: as duas entradas, uma implementação', () => {
  it('F1: `Editar` de `/banks` abre o drawer', () => {
    const handler = BANKS.slice(
      BANKS.indexOf('onEdit={() => {'),
      BANKS.indexOf('onEdit={() => {') + 140,
    )

    expect(handler).toContain('setEditBank(bank)')
    expect(handler).toContain('setSheetOpen(true)')
  })

  it('F2: o alvo é o banco da row, não um fixo', () => {
    /* `setEditBank(bank)` — a variável do map, não um índice ou o primeiro. */
    expect(BANKS).toContain('setEditBank(bank)')
    expect(BANKS).toContain('editTarget={editBank}')
  })

  it('F3: fechar o drawer limpa o alvo', () => {
    /*
      Sem isto, reabrir para outro banco mostraria os campos do anterior até
      o efeito de `reset` rodar.
    */
    expect(BANKS).toContain('if (!open) setEditBank(null)')
  })

  it('F4: a rota do cartão usa o MESMO editor', () => {
    expect(ROTA_CARTAO).toContain('BankSheet')
    expect(ROTA_CARTAO).toContain("from '../../bank-sheet'")
  })

  it('não existe um segundo formulário de banco', () => {
    /*
      Duas implementações divergiriam em validação, labels ou invalidação —
      e o sintoma apareceria como "editar por um caminho salva diferente".
    */
    for (const superficie of [BANKS, ROTA_CARTAO]) {
      expect(superficie).not.toContain('<form id="bank-')
    }
    expect(SHEET).toContain('id="bank-form"')
  })

  it('o editor é um Sheet lateral, não um Dialog central', () => {
    expect(SHEET).toContain('side="right"')
    expect(SHEET).toContain('<Sheet open={open}')
  })
})

describe('D1-D8: o conteúdo do drawer', () => {
  it('D1: os campos carregam os valores atuais do banco', () => {
    expect(SHEET).toContain('name: editTarget.name')
    expect(SHEET).toContain('invoiceDueDate: editTarget.invoiceDueDate')
    expect(SHEET).toContain(
      'invoiceDueDaysAfterClose: editTarget.invoiceDueDaysAfterClose',
    )
  })

  it('D2/D3: os campos editáveis são os que o modelo tem', () => {
    /*
      `invoiceCloseDate` NÃO é editável: o fechamento é derivado do vencimento
      menos o intervalo. Um terceiro input poderia contradizer os outros dois.
    */
    expect(SHEET).toContain("register('invoiceDueDate'")
    expect(SHEET).toContain("register('invoiceDueDaysAfterClose'")
    expect(SHEET).not.toContain("register('invoiceCloseDate'")
  })

  it('D4: a projeção usa a autoridade prospectiva, não datas inventadas', () => {
    expect(SHEET).toContain('getInvoiceCloseDate(')
    expect(SHEET).toContain('getInvoiceDueDate(')
  })

  it('a projeção acompanha o que está DIGITADO', () => {
    /*
      Ler `editTarget` mostraria o ciclo salvo, e o efeito de uma alteração só
      apareceria depois de salvar — quando já não há o que conferir.
    */
    expect(SHEET).toContain("useWatch({ control, name: 'invoiceDueDate' })")
    expect(SHEET).toContain("name: 'invoiceDueDaysAfterClose'")
    /*
      `useWatch`, não `watch()`: aquele devolve função que o React Compiler
      não memoiza, e o lint avisa sobre valores derivados ficarem velhos.
    */
    expect(SHEET).not.toMatch(/watch\('/)
  })

  it('a competência vem da SUPERFÍCIE, não do relógio', () => {
    /* `/banks` tem seletor de mês; a projeção precisa falar do mês exibido. */
    expect(SHEET).toContain('period ?? currentPeriod()')
    expect(BANKS).toContain('period={period}')
  })

  it('sem vencimento válido, nenhuma data é exibida', () => {
    /* Melhor omitir a seção que projetar sobre um campo vazio. */
    expect(SHEET).toContain('if (!Number.isInteger(dueDay)')
    expect(SHEET).toContain('return null')
  })

  it('D5: o helper explica o boundary do fechamento', () => {
    /*
      Contrato V2: o cutoff é EXCLUSIVO — o dia do fechamento já pertence ao
      ciclo seguinte. A frase anterior dizia "entram nesta fatura", que era
      correto sob a policy antiga.
    */
    expect(SHEET).toContain(
      'Compras feitas no dia do fechamento entram na próxima fatura.',
    )
    expect(SHEET).not.toContain('entram nesta fatura')
  })

  it('D8: double-submit é bloqueado', () => {
    expect(SHEET).toContain('disabled={isSubmitting}')
  })

  it('D6/D7: o fechamento em sucesso é decidido por quem submete', () => {
    /*
      O `BankSheet` não fecha a si mesmo: `onSubmit` é `async` e quem chama
      fecha depois do `await`. Erro mantém o drawer aberto por construção —
      a promise rejeita antes de qualquer `setOpen(false)`.
    */
    expect(SHEET).toContain('onSubmit: (data: BankFormData) => Promise<void>')
    expect(BANKS).toContain('setSheetOpen(false)')
  })

  it('a projeção não vira card dentro de card', () => {
    /* Separador e espaçamento, sem moldura própria. */
    expect(SHEET).toContain('border-t border-border pt-4')
    expect(SHEET).not.toContain('rounded-xl border border-border bg-muted')
  })
})

describe('a projeção do ciclo bate com a autoridade', () => {
  /*
    Os números que o drawer exibe saem destas funções — o teste fixa o
    comportamento delas, não a renderização.
  */

  it('vencimento dia 17, fecha 7 dias antes → 10/09 e 17/09', () => {
    expect(getInvoiceDueDate(2026, 9, 17).getDate()).toBe(17)
    expect(getInvoiceCloseDate(2026, 9, 17, 7).getDate()).toBe(10)
  })

  it('§16: vencimento antes do fechamento cruza o mês', () => {
    /*
      Vence dia 5 com 10 dias de intervalo: o fechamento cai em AGOSTO, e a
      competência continua sendo setembro. Close e due não pertencem
      necessariamente ao mesmo mês civil.
    */
    const close = getInvoiceCloseDate(2026, 9, 5, 10)

    expect(close.getMonth() + 1).toBe(8)
    expect(close.getDate()).toBe(26)
    expect(getInvoiceDueDate(2026, 9, 5).getMonth() + 1).toBe(9)
  })

  it('§15: dia 31 é clampado no mês curto', () => {
    /* Fevereiro não tem 31 — e o clamp evita o overflow do `Date`. */
    expect(getInvoiceDueDate(2026, 2, 31).getDate()).toBe(28)
    expect(getInvoiceDueDate(2026, 2, 31).getMonth() + 1).toBe(2)
    /* Abril tem 30. */
    expect(getInvoiceDueDate(2026, 4, 31).getDate()).toBe(30)
  })

  it('§15: ano bissexto', () => {
    expect(getInvoiceDueDate(2028, 2, 31).getDate()).toBe(29)
  })

  it('a virada de ano é respeitada', () => {
    /* Vence 05/01 fechando 10 dias antes → 26/12 do ano anterior. */
    const close = getInvoiceCloseDate(2027, 1, 5, 10)

    expect(close.getFullYear()).toBe(2026)
    expect(close.getMonth() + 1).toBe(12)
    expect(close.getDate()).toBe(26)
  })

  it('o intervalo mínimo é 1 dia', () => {
    /* Zero faria fechamento e vencimento coincidirem. */
    expect(getInvoiceCloseDate(2026, 9, 17, 0).getDate()).toBe(16)
  })

  it('datas de fatura REAL não passam por aqui', () => {
    /*
      A projeção é para competências que ainda não existem. Uma fatura
      persistida tem `closeDate`/`dueDate` congelados, e recalcular pela
      configuração atual era o que fazia as datas de uma fatura paga mudarem.
    */
    const DOC = ler('./invoice-dates.ts')

    expect(DOC).toContain('PROSPECTIVO')
    expect(DOC).toContain('congeladas na criação')
  })
})
