import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  deleteSummaryLine,
  deleteSuccessMessage,
  nothingToDeleteLines,
  preservationLines,
  receivablesLine,
  seriesDisappears,
} from './installment-delete-copy'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Excluir parcelas em aberto — a experiência
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O domínio tem suíte no backend. Aqui se protege o que é do cliente: que a
 * tela não decida nada sozinha, não ofereça o que será recusado, e diga em
 * português o que o servidor devolveu em códigos.
 */

const ler = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8')

/** Sem comentários: a prosa explica o bug e casaria com as asserções. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const EXTRATO = code(ler('../app/(dashboard)/transactions/page.tsx'))
const DIALOG = code(
  ler('../app/(dashboard)/transactions/installment-delete-dialog.tsx'),
)
const ESCOPO = code(
  ler('../app/(dashboard)/transactions/installment-scope-dialog.tsx'),
)
const FATURA = code(ler('../components/invoice-details-drawer.tsx'))
const SERVICE = code(ler('../services/transactions.service.ts'))

const preview = (over: Partial<Parameters<typeof deleteSummaryLine>[0]> = {}) => ({
  deletableCount: 4,
  preservedCount: 6,
  seriesTotal: 10,
  ...over,
})

describe('D1/D2: qual fluxo cada compra usa', () => {
  it('parcelada abre a exclusão de parcelas em aberto', () => {
    const handler = EXTRATO.slice(EXTRATO.indexOf('function handleDelete'))
    const corpo = handler.slice(0, handler.indexOf('\n  }'))

    expect(corpo).toContain('belongsToInstallmentSeries(tx)')
    expect(corpo).toContain('setOpenDeleteTarget(tx)')
  })

  it('não parcelada mantém a confirmação simples', () => {
    const handler = EXTRATO.slice(EXTRATO.indexOf('function handleDelete'))
    const corpo = handler.slice(0, handler.indexOf('\n  }'))

    expect(corpo).toContain('setDeleteTarget(tx)')
  })

  it('o delete não passa mais pelo diálogo de escopo', () => {
    /*
      A regressão a barrar: voltar a perguntar "esta / próximas / todas" numa
      série com histórico pago, onde "todas" sempre resultava em 403.
    */
    expect(EXTRATO).not.toContain("mode: 'delete'")
    expect(FATURA).not.toContain("mode: 'delete'")
  })
})

describe('D33/D34/D35: a edição não muda', () => {
  it('editar continua escolhendo escopo', () => {
    expect(EXTRATO).toContain("setScopeDialog({ tx: editTx, mode: 'edit' })")
  })

  it('o diálogo de escopo continua oferecendo os três escopos', () => {
    expect(ESCOPO).toContain('InstallmentScope.ONE')
    expect(ESCOPO).toContain('InstallmentScope.NEXT')
    expect(ESCOPO).toContain('InstallmentScope.ALL')
  })

  it('OPEN não aparece na UI de edição', () => {
    expect(ESCOPO).not.toContain('OPEN')
  })
})

describe('D8: o servidor é a autoridade', () => {
  it('o diálogo não recalcula deletabilidade', () => {
    /*
      Nenhum `invoice.status === 'PAID'` no cliente: foi essa duplicação de
      regra que fez a tela oferecer o que o servidor recusava.
    */
    expect(DIALOG).not.toContain("status === 'PAID'")
    expect(DIALOG).not.toContain('isPaid')
    expect(DIALOG).toContain('previewDeleteTransaction')
  })

  it('a prévia é da tarefa, não um dado global', () => {
    /* Reutilizar a prévia de outra série mostraria o impacto errado. */
    expect(DIALOG).toContain("queryKey: ['transaction-delete-preview'")
    expect(DIALOG).toContain('gcTime: 0')
    expect(EXTRATO).toContain("key={openDeleteTarget?.id ?? 'none'}")
  })
})

describe('D3/D6: quando o botão destrutivo existe', () => {
  it('carregando bloqueia a confirmação', () => {
    expect(DIALOG).toContain('disabled={!podeConfirmar}')
    expect(DIALOG).toContain('!carregando')
  })

  it('sem parcela deletável não há botão destrutivo', () => {
    expect(DIALOG).toContain('{!nadaAExcluir && (')
    expect(DIALOG).toContain("nadaAExcluir = Boolean(preview) && preview!.deletableCount === 0")
  })

  it('erro na prévia oferece nova tentativa', () => {
    expect(DIALOG).toContain('Tentar novamente')
    expect(DIALOG).toContain('refetch()')
  })
})

describe('D4/D5: a frase principal', () => {
  it('série inteiramente aberta', () => {
    const linha = deleteSummaryLine(preview({ deletableCount: 10, preservedCount: 0 }))
    expect(linha).toBe('10 parcelas em aberto serão excluídas.')
  })

  it('série mista NÃO diz "todas as parcelas"', () => {
    /*
      Numa série 6 pagas / 4 abertas, "todas" sugeriria que o histórico vai
      junto — exatamente o medo que esta operação precisa dissipar.
    */
    const linha = deleteSummaryLine(preview())
    expect(linha).toBe(
      '4 parcelas em aberto serão excluídas. As 6 parcelas restantes serão preservadas.',
    )
    expect(linha).not.toContain('todas')
  })

  it('singular quando é uma só', () => {
    expect(
      deleteSummaryLine(preview({ deletableCount: 1, preservedCount: 0 })),
    ).toBe('1 parcela em aberto será excluída.')
  })

  it('avisa quando a compra inteira desaparece', () => {
    expect(seriesDisappears({ deletableCount: 10, preservedCount: 0 })).toBe(true)
    expect(seriesDisappears({ deletableCount: 4, preservedCount: 6 })).toBe(false)
  })
})

describe('D7/D8/D9: os motivos em português', () => {
  const preservada = (reason: string, id: string) => ({
    id,
    installmentNumber: 1,
    amount: 100,
    date: '2026-01-10',
    reason: reason as never,
    message: '',
  })

  it('fatura paga', () => {
    const linhas = preservationLines({
      preserved: [preservada('PAID_INVOICE', 'a')],
    })
    expect(linhas[0]).toContain('fatura dela já foi paga')
  })

  it('cobrança recebida', () => {
    const linhas = preservationLines({
      preserved: [preservada('RECEIVABLE_ALREADY_PAID', 'a')],
    })
    expect(linhas[0]).toContain('cobrança dela já foi recebida')
  })

  it('comprovante de quitação', () => {
    const linhas = preservationLines({
      preserved: [preservada('PAYMENT_TRANSACTION_LINKED', 'a')],
    })
    expect(linhas[0]).toContain('pagamento de uma dívida ou cobrança')
  })

  it('nenhum código interno vaza para a tela', () => {
    const linhas = preservationLines({
      preserved: [
        preservada('PAID_INVOICE', 'a'),
        preservada('RECEIVABLE_ALREADY_PAID', 'b'),
        preservada('PAYMENT_TRANSACTION_LINKED', 'c'),
      ],
    })

    for (const linha of linhas) {
      expect(linha).not.toContain('PAID_INVOICE')
      expect(linha).not.toContain('RECEIVABLE_ALREADY_PAID')
      expect(linha).not.toContain('PAYMENT_TRANSACTION_LINKED')
      expect(linha).not.toMatch(/[A-Z]{4,}_[A-Z]/)
    }
  })

  it('uma linha por MOTIVO, não por parcela', () => {
    /* Seis linhas dizendo a mesma coisa seriam ruído. */
    const linhas = preservationLines({
      preserved: [
        preservada('PAID_INVOICE', 'a'),
        preservada('PAID_INVOICE', 'b'),
        preservada('PAID_INVOICE', 'c'),
        preservada('RECEIVABLE_ALREADY_PAID', 'd'),
      ],
    })

    expect(linhas).toHaveLength(2)
    expect(linhas[0]).toContain('3 parcelas')
    expect(linhas[1]).toContain('1 parcela')
  })

  it('zero deletáveis explica os motivos', () => {
    const linhas = nothingToDeleteLines({
      preserved: [preservada('PAID_INVOICE', 'a')],
    })
    expect(linhas).toHaveLength(1)
  })
})

describe('D10: cobranças que saem junto', () => {
  it('informa quando há cobrança pendente vinculada', () => {
    expect(receivablesLine({ receivablesRemoved: 1 })).toContain(
      'cobrança pendente',
    )
    expect(receivablesLine({ receivablesRemoved: 3 })).toContain('3 cobranças')
  })

  it('cala quando não há nenhuma', () => {
    expect(receivablesLine({ receivablesRemoved: 0 })).toBeNull()
  })
})

describe('D11: a confirmação envia os ids exatos', () => {
  it('manda os ids exibidos, não a contagem', () => {
    /*
      Contagem não detecta troca: A,B,C → A,B,D mantém três e apagaria outro
      conjunto sob a confirmação do primeiro.
    */
    expect(DIALOG).toContain('preview!.deletable.map((item) => item.id)')
    expect(SERVICE).toContain('expectedDeletableIds: string[]')
    expect(SERVICE).toContain("params: { scope: 'OPEN' }")
  })
})

describe('D12/D13/D14/D15: conjunto obsoleto', () => {
  it('DELETE_SET_CHANGED não repete a exclusão sozinho', () => {
    const erro = EXTRATO.slice(EXTRATO.indexOf('const openDeleteMut'))
    const corpo = erro.slice(0, erro.indexOf('const deleteMut'))

    expect(corpo).toContain('DELETE_SET_CHANGED')
    /* Nada de re-disparar a mutation dentro do próprio onError. */
    expect(corpo.slice(corpo.indexOf('onError'))).not.toContain(
      'openDeleteMut.mutate',
    )
  })

  it('a prévia atualizada substitui a exibida', () => {
    expect(EXTRATO).toContain('setRefreshedDeletePreview(await previewDeleteTransaction(id))')
    expect(DIALOG).toContain('refreshedPreview ?? fetched')
  })

  it('a mudança é anunciada e exige nova confirmação', () => {
    expect(DIALOG).toContain('A situação das parcelas mudou')
  })

  it('se a nova prévia zerar, o botão destrutivo some', () => {
    /* `nadaAExcluir` deriva do preview vigente, que já é o atualizado. */
    expect(DIALOG).toContain('const preview = refreshedPreview ?? fetched ?? null')
  })
})

describe('D16/D17/D18/D19: sucesso', () => {
  it('o toast usa a contagem real da execução', () => {
    expect(deleteSuccessMessage(1)).toBe('1 parcela em aberto excluída')
    expect(deleteSuccessMessage(4)).toBe('4 parcelas em aberto excluídas')
    expect(EXTRATO).toContain('deleteSuccessMessage(result.deletedCount)')
  })

  it('o painel fecha SOMENTE se a transação aberta foi removida', () => {
    /*
      Numa série mista o usuário pode estar vendo uma parcela preservada.
      Fechar o detalhe dela dispensaria uma entidade que continua existindo —
      era o que o `detail.close()` incondicional fazia.
    */
    expect(EXTRATO).toContain(
      'if (detail.openId && result.deletedIds.includes(detail.openId)) {',
    )
  })

  it('a decisão vem do resultado, não de refetch', () => {
    const sucesso = EXTRATO.slice(EXTRATO.indexOf('const openDeleteMut'))
    const corpo = sucesso.slice(0, sucesso.indexOf('onError'))

    expect(corpo).toContain('result.deletedIds')
    expect(corpo).not.toContain('await refetch')
  })
})

describe('D21/D22/D23/D24: erros', () => {
  it('falha técnica mantém o diálogo com a mensagem', () => {
    expect(EXTRATO).toContain('setOpenDeleteError(')
    expect(DIALOG).toContain('executionError')
  })

  it('nenhum erro limpa a URL do detalhe', () => {
    const erro = EXTRATO.slice(EXTRATO.indexOf('const openDeleteMut'))
    const corpo = erro.slice(erro.indexOf('onError'), erro.indexOf('const deleteMut'))

    expect(corpo).not.toContain('detail.close()')
  })
})

describe('D25/D26/D27: âncora de tarefa', () => {
  it('a exclusão de parcelas conta como tarefa aberta', () => {
    const inicio = EXTRATO.indexOf('const taskOpen')
    const fim = EXTRATO.slice(inicio).search(/\r?\n[ \t]*\r?\n/)
    const derivacao = EXTRATO.slice(inicio, inicio + fim)

    expect(derivacao).toContain('openDeleteTarget !== null')
  })

  it('a tarefa nasce ancorada no detalhe', () => {
    const handler = EXTRATO.slice(EXTRATO.indexOf('function handleDelete'))
    expect(handler.slice(0, handler.indexOf('\n  }'))).toContain(
      'taskAnchor.beginFromDetail()',
    )
  })

  it('o cleanup de órfã fecha a exclusão de parcelas', () => {
    const inicio = EXTRATO.indexOf('const closeTransientTasks')
    const fim = EXTRATO.slice(inicio).search(/\r?\n {2}\}/)
    const corpo = EXTRATO.slice(inicio, inicio + fim)

    expect(corpo).toContain('setOpenDeleteTarget(null)')
    expect(corpo).toContain('setRefreshedDeletePreview(null)')
  })
})

describe('D29/D30/D31/D32: o painel da fatura', () => {
  it('usa o mesmo diálogo e o mesmo serviço', () => {
    expect(FATURA).toContain('InstallmentDeleteDialog')
    expect(FATURA).toContain('deleteOpenInstallments')
  })

  it('não expõe escopo no delete', () => {
    const handler = FATURA.slice(FATURA.indexOf('function handleDeleteTx'))
    const corpo = handler.slice(0, handler.indexOf('\n  }'))

    expect(corpo).toContain('setOpenDeleteTarget(tx)')
    expect(corpo).not.toContain('setScopeDialog')
  })

  it('não cria transactionId incidentalmente', () => {
    /* O painel é da FATURA e continua sem conhecer rota. */
    expect(FATURA).not.toContain('useRouter')
    expect(FATURA).not.toContain('useSearchParams')
    expect(FATURA).not.toContain("detail.open(")
  })

  it('invalida as superfícies da pessoa quando alguma cobrança saiu', () => {
    expect(FATURA).toContain('result.receivablesRemoved > 0')
    expect(FATURA).toContain("queryKey: ['person-statement']")
  })
})

describe('D34: invalidação específica do novo fluxo', () => {
  it('as superfícies de pessoa só são invalidadas quando há cobrança removida', () => {
    /*
      Invalidar sempre custaria duas requisições em toda exclusão de compra
      própria, que não altera saldo de ninguém.
    */
    const sucesso = EXTRATO.slice(EXTRATO.indexOf('const openDeleteMut'))
    const corpo = sucesso.slice(0, sucesso.indexOf('onError'))

    expect(corpo).toContain('if (result.receivablesRemoved > 0) {')
    expect(corpo).toContain("queryKey: ['persons']")
    expect(corpo).toContain("queryKey: ['person-statement']")
  })

  it('usa as chaves canônicas do projeto', () => {
    expect(EXTRATO).not.toContain("['personStatement']")
    expect(FATURA).not.toContain("['personStatement']")
  })

  it('as outras mutations do Extrato não foram alteradas (G3 segue backlog)', () => {
    const create = EXTRATO.slice(EXTRATO.indexOf('const createMut'))
    const corpo = create.slice(0, create.indexOf('const updateMut'))

    expect(corpo).not.toContain("queryKey: ['person-statement']")
  })
})
