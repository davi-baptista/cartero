import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { budgetAllSettled, budgetDueTone } from './budget-row-view'
import { invoiceRowPresentation } from './invoice-row-presenter'
import { BANK_TRAILING_LABEL, BANK_TRAILING_TONE } from './bank-invoice-selection'
import { InvoiceStatus, type Invoice } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O Orçamento entrou no design system das listas financeiras
 * ══════════════════════════════════════════════════════════════════════════
 *
 * As rows tinham o estado numa badge ao lado do nome, e uma fatura paga acendia
 * quatro sinais de sucesso — fundo do ícone, ícone, valor e badge. A mesma
 * informação em Bancos usa um: o status.
 *
 * Esta fase é APRESENTAÇÃO. Nenhum número, competência ou classificação muda.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const BUDGET = ler('../app/(dashboard)/budget/page.tsx')
const BUDGET_CODE = semComentarios(BUDGET)
const ROW = ler('../components/ui/status-list-row.tsx')
const ROW_CODE = semComentarios(ROW)
const BANKS = ler('../app/(dashboard)/banks/page.tsx')
const PERSONS = ler('../app/(dashboard)/persons/page.tsx')

function invoice(status: InvoiceStatus): Invoice {
  return {
    id: 'i1',
    status,
    closeDate: '2026-09-20',
    dueDate: '2026-09-27',
    totalAmount: 100,
  } as unknown as Invoice
}

describe('B1-B4: o summary usa a escala das outras listas', () => {
  it('B1: o total usa o MESMO token de Bancos e Pessoas', () => {
    /*
      Eram 38px — hero typography que fazia o total do Orçamento parecer de
      outra ordem de importância que "Faturas de setembro" ou "Saldo com
      pessoas", quando as três respondem a mesma classe de pergunta.
    */
    const escala = 'text-[22px] font-semibold tabular-nums tracking-[-0.02em]'

    expect(BUDGET).toContain(escala)
    expect(BANKS).toContain(escala)
    expect(PERSONS).toContain(escala)
  })

  it('B2: o hero antigo não sobreviveu', () => {
    expect(BUDGET).not.toContain('text-[38px]')
    expect(BUDGET_CODE).not.toContain('tracking-[-0.025em]')
  })

  it('B3: a composição continua saindo dos agregados do backend', () => {
    /*
      Somar na tela abriria espaço para o Orçamento discordar do próprio total
      por um centavo.
    */
    expect(BUDGET_CODE).toContain('breakdownParts')
    expect(BUDGET_CODE).toContain('budgetBreakdownAriaLabel')
  })

  it('B4/B29: o total continua sendo `summary.totalToPay`, intocado', () => {
    expect(BUDGET_CODE).toContain('formatCurrency(summary.totalToPay)')
  })

  it('o total é NEUTRO — nem verde nem vermelho', () => {
    /*
      O número não é erro, atraso nem conquista: é o custo normal da
      competência. Quem diz o estado é a linha de "Tudo em dia".
    */
    const bloco = BUDGET_CODE.slice(
      BUDGET_CODE.indexOf('formatCurrency(summary.totalToPay)') - 400,
      BUDGET_CODE.indexOf('formatCurrency(summary.totalToPay)'),
    )

    expect(bloco).not.toContain('text-paid')
    expect(bloco).not.toContain('text-destructive')
    expect(bloco).not.toContain('text-receivable')
  })
})

describe('B5-B12: a row de fatura', () => {
  it('B5/B19: a badge não existe mais em nenhuma row', () => {
    /*
      Ela dizia o estado na largura que o nome precisa no mobile — "Mercado
      Pago [Aberta] >" — para comunicar algo que cabe sob o valor.
    */
    expect(BUDGET_CODE).not.toContain('badge=')
    expect(ROW_CODE).not.toContain('badge')
  })

  it('B6: OPEN devolve FATURA ABERTA', () => {
    expect(invoiceRowPresentation(invoice(InvoiceStatus.OPEN)).statusLabel).toBe(
      'Fatura aberta',
    )
  })

  it('B7: CLOSED devolve FATURA FECHADA', () => {
    expect(invoiceRowPresentation(invoice(InvoiceStatus.CLOSED)).statusLabel).toBe(
      'Fatura fechada',
    )
  })

  it('B8: OVERDUE devolve FATURA VENCIDA', () => {
    expect(invoiceRowPresentation(invoice(InvoiceStatus.OVERDUE)).statusLabel).toBe(
      'Fatura vencida',
    )
  })

  it('B9: PAID devolve PAGA', () => {
    expect(invoiceRowPresentation(invoice(InvoiceStatus.PAID)).statusLabel).toBe('Paga')
  })

  it('o rótulo é o de BANCOS, não uma segunda cópia', () => {
    /*
      Duas tabelas de rótulos divergiriam na primeira mudança, e o mesmo
      status sairia com nomes diferentes em duas telas.
    */
    for (const st of [
      InvoiceStatus.OPEN,
      InvoiceStatus.CLOSED,
      InvoiceStatus.OVERDUE,
      InvoiceStatus.PAID,
    ]) {
      const { statusLabel: label, statusTone: tone } = invoiceRowPresentation(
        invoice(st),
      )
      expect(Object.values(BANK_TRAILING_LABEL)).toContain(label)
      expect(Object.values(BANK_TRAILING_TONE)).toContain(tone)
    }
  })

  it('B10: o status vive no trailing — em CADA tipo de row', () => {
    /*
      Um `toContain('trailing={')` global não bastava: com quatro listas na
      página, remover o trailing de UMA delas ainda casaria pelas outras.
      Cada bloco é verificado no seu próprio recorte.
    */
    expect(ROW_CODE).toContain('{trailing}')

    const bloco = (marcador: string, tamanho = 2200) =>
      BUDGET_CODE.slice(
        BUDGET_CODE.indexOf(marcador),
        BUDGET_CODE.indexOf(marcador) + tamanho,
      )

    /* Faturas — pelo presenter compartilhado com Bancos. */
    const faturas = bloco('invoices.map(')
    expect(faturas).toContain('trailing={')
    expect(faturas).toContain('apresentacao.statusLabel')

    /* Acertos com pessoas. */
    const pessoas = bloco('visiblePeople.map(')
    expect(pessoas).toContain('trailing={')
    expect(pessoas).toContain('peopleRowStatusLabel(')

    /* Dívidas do mês. */
    const dividas = bloco('standaloneDebtRows.map(')
    expect(dividas).toContain('trailing={')
    expect(dividas).toContain('cfg.trailingLabel')

    /* Pendências anteriores. */
    const anteriores = bloco('standalonePriorItems.map(')
    expect(anteriores).toContain('trailing={')
    expect(anteriores).toContain("'PAGA' : 'EM ATRASO'")
  })

  it('B11: o prazo fica abaixo do nome, no slot canônico', () => {
    expect(ROW_CODE).toContain('ROW_META_CLASS')

    const faturas = BUDGET_CODE.slice(
      BUDGET_CODE.indexOf('invoices.map('),
      BUDGET_CODE.indexOf('invoices.map(') + 2200,
    )
    expect(faturas).toContain('meta={')
    expect(faturas).toContain('apresentacao.timingLabel')
    expect(faturas).toContain('apresentacao.timingTone')
  })

  it('B12/probe 11: o mês não é repetido na row', () => {
    /*
      O seletor no topo já diz de que competência a lista é; repetir em cada
      linha gastaria a largura do nome para não informar nada.
    */
    const bloco = BUDGET_CODE.slice(
      BUDGET_CODE.indexOf('invoices.map('),
      BUDGET_CODE.indexOf('invoices.map(') + 1800,
    )

    expect(bloco).not.toContain('formatMonthYear')
    expect(bloco).not.toContain('inv.month')
  })
})

describe('B13-B18: a cor da fatura', () => {
  it('B13/B24/probe 5: o valor é neutro em TODOS os estados', () => {
    /*
      R$ 1.940,95 é o mesmo número pago ou não. O tone deixou de expor
      `amount`, então a fonte antiga da cor não existe mais.
    */
    expect(ROW_CODE).toContain('{ bg: string; icon: string }')
    expect(ROW_CODE).not.toContain('amountClasses')
    expect(ROW_CODE).not.toContain('amountTone')

    /*
      E o SPAN do valor não recebe classe alguma além da escala. Sem este
      assert, bastava escrever uma nova expressão de cor ali para a row voltar
      a pintar o número por estado — a regressão exata que a fase corrige.
    */
    const span = ROW_CODE.slice(
      ROW_CODE.indexOf('formatCurrency(amount)') - 220,
      ROW_CODE.indexOf('formatCurrency(amount)'),
    )
    expect(span).toContain('className={STATUS_ROW_AMOUNT_CLASS}')
    expect(span).not.toContain('text-paid')
    expect(span).not.toContain('text-destructive')
    expect(span).not.toContain('text-receivable')
  })

  it('B14/probe 6: o ícone não fica verde quando pago', () => {
    /*
      O ícone diz que aquilo é uma fatura, não em que estado ela está. O fundo
      tonal (10%) sobrevive como sinal discreto; a cor do glyph, não.
    */
    expect(ROW_CODE).toContain("positive: { bg: 'bg-paid/10', icon: 'text-muted-foreground' }")
    expect(ROW_CODE).not.toContain("icon: 'text-paid'")
  })

  it('B15: o trailing PAGA é verde', () => {
    expect(invoiceRowPresentation(invoice(InvoiceStatus.PAID)).statusTone).toBe(
      'text-paid',
    )
  })

  it('B16/B17/B18: o prazo segue a régua canônica', () => {
    const dia = (d: number) => {
      const t = new Date()
      t.setDate(t.getDate() + d)
      return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
    }

    /* B17: atraso. */
    expect(budgetDueTone(dia(-3))).toBe('text-destructive')
    /* B16: urgência — a mesma janela de 7 dias de Bancos e Pessoas. */
    expect(budgetDueTone(dia(0))).toBe('text-pending')
    expect(budgetDueTone(dia(1))).toBe('text-pending')
    expect(budgetDueTone(dia(7))).toBe('text-pending')
    /* B18: distante não é alerta. */
    expect(budgetDueTone(dia(8))).toBe('')
    expect(budgetDueTone(dia(40))).toBe('')
  })

  it('B12/probe 10: a lógica temporal é a de Bancos, não uma local', () => {
    /*
      A mesma fatura aparece nas duas telas. Uma segunda definição de
      "vencida" ou de "quantos dias são urgentes" faria o mesmo fato sair
      diferente em cada lugar.
    */
    /*
      A apresentação da FATURA migrou para `invoice-row-presenter`, a
      autoridade que Bancos e Orçamento compartilham — mantê-la num módulo
      específico do Orçamento foi o que permitiu as duas divergirem no tom do
      prazo pago.
    */
    const presenter = semComentarios(ler('./invoice-row-presenter.ts'))
    expect(presenter).toContain('bankTrailingState')
    expect(presenter).toContain('BANK_TRAILING_LABEL')
    expect(presenter).toContain('invoiceTimingClass')

    /* O prazo de DÍVIDA continua aqui, com a mesma régua. */
    expect(semComentarios(ler('./budget-row-view.ts'))).toContain('timingUrgency')
    expect(BUDGET_CODE).toContain('invoiceRowPresentation(inv)')
  })

  it('resolvido não colore a data do vencimento', () => {
    /*
      `PAGA` no trailing já diz o estado; pintar o vencimento de verde faria a
      data parecer o fato comemorado.
    */
    expect(budgetDueTone('2020-01-01', true)).toBe('')
  })
})

describe('B19-B24: a row de pessoa e de dívida', () => {
  it('B20: dívida aberta usa o trailing muted, não uma pílula azul', () => {
    /*
      "A pagar" fica muted como `FATURA ABERTA`: pendência é o estado normal
      de uma lista de obrigações, e o âmbar está reservado ao prazo.
    */
    expect(BUDGET_CODE).toContain("trailingLabel: 'A PAGAR'")
    expect(BUDGET_CODE).toContain("trailingTone: 'text-muted-foreground'")
    expect(BUDGET_CODE).not.toContain("'bg-primary/15 text-primary'")
  })

  it('B20: dívida em atraso mantém o vermelho e o vocabulário oficial', () => {
    expect(BUDGET_CODE).toContain("trailingLabel: 'EM ATRASO'")
    expect(BUDGET_CODE).not.toContain("label: 'Vencida'")
  })

  it('B22: resolvido usa o verde de success', () => {
    expect(BUDGET_CODE).toContain("trailingLabel: 'PAGA'")
    expect(BUDGET_CODE).toContain("trailingTone: 'text-paid'")
  })

  it('B23/probe 7: resolvido não duplica o status no subtexto', () => {
    /*
      O trailing diz PAGO; "Pago" abaixo do nome exibiria o mesmo fato duas
      vezes. A metadata resolvida passou a dizer QUANDO ("Quitado em 18/08"),
      que é informação nova — a esquerda responde quando, a direita como.
    */
    expect(BUDGET_CODE).toContain('settlementRowMeta(view.status,')

    const meta = semComentarios(ler('./budget-settlement-meta.ts'))
    expect(meta).toContain('Quitado em ')
    /* O verbo é único: nunca "Pago em"/"Recebido em" ao lado de PAGO/RECEBIDO. */
    expect(meta).not.toContain('`Pago em ')
    expect(meta).not.toContain('`Recebido em ')
  })

  it('B21: em aberto, a metadata é o PRAZO', () => {
    /*
      A composição bilateral era metadata de recurso: o payload não trazia
      `dueDate`, então a linha exibia "R$ 10 a receber · R$ 11 a pagar" — que
      explica o valor mas não diz quando algo acontece.

      Com `open.nextItem` no read model, o prazo assume. A composição continua
      no drawer, que é a superfície de detalhe.
    */
    expect(BUDGET_CODE).toContain('nextItem: person.open.nextItem')
    expect(BUDGET_CODE).not.toContain('view.metadata[0]')
  })

  it('B19/B20: o vocabulário é o de Pessoas', () => {
    expect(BUDGET_CODE).toContain('peopleRowStatusLabel(view.status, view.direction)')
  })

  it('pendência anterior conserva o vencimento ORIGINAL', () => {
    /* Sem ele a linha não se explica: é a razão de ser da seção. */
    expect(BUDGET).toContain('Venceu em {formatDate(item.dueDate)}')
    expect(BUDGET_CODE).toContain('budgetDueTone(item.dueDate, item.paidInMonth)')
  })
})

describe('B25-B28: "Tudo em dia"', () => {
  it('B25: mês com tudo resolvido recebe a frase', () => {
    expect(budgetAllSettled({ totalPaid: 2591.25, totalPending: 0 })).toBe(true)
  })

  it('B28/probe: mês vazio NÃO recebe a frase', () => {
    /*
      Um mês vazio tem `totalPending: 0` como um mês inteiramente quitado.
      Sem checar `totalPaid`, a tela parabenizaria quem simplesmente não teve
      obrigação nenhuma — nunca ter tido e ter quitado todas são fatos
      diferentes.
    */
    expect(budgetAllSettled({ totalPaid: 0, totalPending: 0 })).toBe(false)
  })

  it('mês com pendência não recebe a frase', () => {
    expect(budgetAllSettled({ totalPaid: 500, totalPending: 300 })).toBe(false)
    expect(budgetAllSettled({ totalPaid: 0, totalPending: 300 })).toBe(false)
  })

  it('centavos de resíduo não decidem', () => {
    expect(budgetAllSettled({ totalPaid: 100, totalPending: 0.001 })).toBe(true)
    expect(budgetAllSettled({ totalPaid: 0.001, totalPending: 0 })).toBe(false)
  })

  it('B26: a frase é verde, e é a MESMA de Bancos', () => {
    /*
      O mesmo `text-paid` e a mesma frase de Bancos — nem um segundo verde,
      nem um segundo vocabulário para o mesmo fato.
    */
    expect(BUDGET_CODE).toContain('font-medium text-paid')
    expect(BUDGET_CODE).toContain('Tudo em dia')
    /* A frase de Bancos vive no helper do resumo dele. */
    expect(ler('./bank-month-summary-lines.ts')).toContain("text: 'Tudo em dia'")
  })

  it('B27: o total continua neutro mesmo com tudo resolvido', () => {
    /*
      A conclusão é uma linha própria justamente para o número não precisar
      mudar de cor.
    */
    expect(BUDGET_CODE).not.toContain('tudoEmDia && \'text-paid\'')
    expect(BUDGET_CODE).toContain('tudoEmDia && (')
  })

  it('não coexiste com a divisão pago/a pagar', () => {
    /*
      `hasMix` mostra a divisão quando ainda falta algo; esta aparece quando
      nada falta. Com `totalPending` zerado não há mistura a exibir.
    */
    const mix = { totalPaid: 500, totalPending: 300 }
    expect(mix.totalPaid > 0 && mix.totalPending > 0).toBe(true)
    expect(budgetAllSettled(mix)).toBe(false)
  })
})

describe('B29-B34: o domínio financeiro não mudou', () => {
  it('B30/B31: a decomposição da fatura continua vindo do helper', () => {
    /*
      `invoiceRowView` decide bruto / sua parte / de terceiros. Esta fase não
      toca nele — e o valor em destaque continua o BRUTO, o mesmo que o drawer
      mostra ao abrir.
    */
    expect(BUDGET_CODE).toContain('invoiceRowView({')
    expect(BUDGET_CODE).toContain('amount={view.gross}')
  })

  it('B32: a classificação de pendências anteriores é a mesma', () => {
    expect(BUDGET_CODE).toContain('budget?.debts.priorItems ?? []')
    expect(BUDGET).toContain('Venceram antes deste mês')
  })

  it('B33/B34: os valores continuam saindo do backend, sem recálculo local', () => {
    for (const campo of [
      'summary.totalToPay',
      'summary.totalPaid',
      'summary.totalPending',
      'summary.totalDirectPayments',
    ]) {
      expect(BUDGET_CODE).toContain(campo)
    }
  })

  it('probe 12: o clique da row não mudou', () => {
    expect(BUDGET_CODE).toContain("setDrawerParam('invoiceId', inv.id)")
    expect(BUDGET_CODE).toContain("setDrawerParam('personId', person.personId)")
  })

  it('probe 9: o netting por pessoa continua no backend', () => {
    /* `payable` é `max(dívidas − recebíveis, 0)`, decidido lá. */
    const servico = semComentarios(ler('../services/budget.service.ts'))
    expect(servico).toContain('payable')
  })
})

describe('os containers das seções sobrevivem a esta fase', () => {
  it('as listas continuam dentro dos cards', () => {
    /*
      Fora de escopo por decisão explícita: primeiro avaliar a nova hierarquia
      com a estrutura atual, para não misturar duas mudanças visuais grandes.
    */
    const cards = BUDGET.match(
      /overflow-hidden rounded-xl border border-border divide-y divide-border\/60/g,
    )
    expect(cards?.length).toBeGreaterThanOrEqual(4)
  })
})

describe('a geometria da row é única', () => {
  it('não há mais dois layouts conforme o conteúdo', () => {
    /*
      Havia: sem `subtitle` a row era `items-center`; com ele virava
      `flex-col` e a metadata descia em largura cheia — duas alturas na mesma
      lista, e o `flex-col` desalinhava o ícone.
    */
    expect(ROW_CODE).not.toContain('flex-col justify-center gap-1')
    expect(ROW_CODE).toContain('items-start')
  })

  it('o chevron continua junto do título', () => {
    /* Não na extrema direita: ele qualifica o nome, não a coluna de valores. */
    const titulo = ROW_CODE.slice(
      ROW_CODE.indexOf('STATUS_ROW_TITLE_CLASS}>{title}'),
    )
    expect(titulo.slice(0, 200)).toContain('DisclosureChevron')
  })

  it('valor e status compartilham a coluna direita', () => {
    expect(ROW_CODE).toContain('flex shrink-0 flex-col items-end gap-1')
  })
})
