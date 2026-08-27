import { api } from '@/lib/api'
import type { Invoice } from '@/types'

/**
 * Fatura do orçamento: o servidor sempre resolve `reimbursable` e `ownAmount`
 * neste endpoint, então eles são obrigatórios aqui.
 */
export type BudgetInvoice = Invoice &
  Required<Pick<Invoice, 'reimbursable' | 'ownAmount'>>

export interface BudgetSummary {
  month: number
  year: number
  /**
   * Renda DO PERÍODO consultado, resolvida pelo histórico.
   *
   * `null` quando desconhecida. Antes vinha de `User.salary` — o valor atual —
   * então alterar a renda hoje reescrevia a sobra de meses já encerrados.
   */
  salary: number | null
  /**
   * `false` quando não há entrada aplicável ao mês.
   *
   * Diferente de `salary: 0`, que é renda conhecida e igual a zero. A tela
   * precisa distinguir: "R$ 0,00" para um mês desconhecido é um fato falso.
   */
  salaryKnown: boolean
  /** Competência da entrada que forneceu o valor. */
  salaryEffectiveFrom: { year: number; month: number } | null
  /** Sobra estimada. `null` quando a renda é desconhecida. */
  remaining: number | null
  /** Percentual comprometido. `null` quando desconhecida OU zero. */
  committedPct: number | null
  totalInvoices: number
  totalReimbursable: number
  netAmount: number
  /** Débito, PIX e boleto lançados dentro do mês. */
  totalDirectPayments: number
  /**
   * Composição das dívidas do mês.
   *
   * `totalDebts` sozinho não dizia de onde vinha o número — e antes vinha de
   * um valor já compensado por recebíveis.
   */
  debts: {
    /**
     * Vence no mês e continua ABERTA.
     *
     * Dívida resolvida NÃO entra aqui: ela pertence financeiramente ao mês em
     * que o dinheiro saiu (`paidInMonth`). Contá-la nos dois representaria a
     * mesma obrigação duas vezes.
     */
    openDueInMonth: number
    /**
     * Pendências anteriores ainda ABERTAS — zero fora do mês corrente.
     *
     * `priorCarry` foi removido: aquele campo era o snapshot mensal que
     * repetia a mesma dívida em toda competência entre o vencimento e o
     * pagamento. Manter o nome apontando para outro conceito faria qualquer
     * consumidor calcular errado sem aviso.
     */
    currentOpenPrior: number
    /** PAGAS nesta competência, qualquer que tenha sido o vencimento. */
    paidInMonth: number
    /** `openDueInMonth + currentOpenPrior + paidInMonth`. */
    total: number
    priorItems: Array<{
      title: string
      amount: number
      /** Vencimento ORIGINAL — nunca reescrito como se fosse deste mês. */
      dueDate: string
      personId: string | null
      personName: string | null
      /** Se já havia sido paga dentro do mês consultado. */
      paidInMonth: boolean
    }>
  }
  /** Espelho de `debts.total`. */
  totalDebts: number
  /** Quantidade de dívidas com vencimento dentro do mês. */
  debtsCount: number
  priorCount: number
  /** Quantas dessas dívidas já estão pagas. */
  paidDebtsCount: number
  /**
   * Consolidação por pessoa — camada de APRESENTAÇÃO, em DOIS universos.
   *
   * Eles respondem perguntas diferentes e nunca devem ser somados entre si:
   *
   *   `budget` → "o que dessa pessoa pertenceu ao orçamento desta
   *              competência?". Temporal, reconstruído por `paidAt`. Inclui
   *              item já quitado, porque ele continuou sendo obrigação daquele
   *              mês. É o que permite a tela fechar com `debts.total` e
   *              `totalToPay`.
   *
   *   `open`   → "quanto ainda falta acertar com essa pessoa?". Estado atual
   *              (`isPaid: false`). Zera no instante em que o item é quitado.
   *
   * A versão anterior tinha um universo só, construído sobre `paidAt` e
   * apresentado como pendência. Isso produzia dois erros de leitura: um
   * recebível já recebido aparecia como "R$ 300 a receber de períodos
   * anteriores", e uma dívida já paga seguia como "A pagar R$ 200".
   *
   * **Nada aqui alimenta `totalToPay`, `remaining` ou `committedPct`.**
   */
  peopleSettlements: Array<{
    personId: string
    personName: string
    /** Contexto do orçamento — pode incluir item já quitado. */
    budget: {
      receivableDueInMonth: number
      /** Vence no mês e continua aberta. */
      openDueInMonth: number
      /** Anteriores ainda abertas (só no mês corrente). */
      currentOpenPrior: number
      /** Pagas nesta competência, qualquer vencimento. */
      paidInMonth: number
      /** Recebíveis desta pessoa relevantes para a competência. */
      receivableAmount: number
      /**
       * O que esta pessoa acrescenta ao `totalToPay`.
       *
       * `max(dívidas − recebíveis, 0)`. Netting POR PESSOA: quem me deve mais
       * do que eu devo contribui com ZERO, nunca com crédito, e nunca reduz
       * obrigações com terceiros.
       */
      payable: number
      /** `openDueInMonth + currentOpenPrior + paidInMonth`. */
      debtTotal: number
      automaticReceivable: number
    }
    /** Em aberto AGORA — o que ainda falta acertar. */
    open: {
      receivableInMonth: number
      debtInMonth: number
      /**
       * Pendências anteriores JÁ VENCIDAS hoje.
       *
       * `overdue` no nome de propósito: só `prior` sugeria qualquer item de
       * mês anterior, e essa leitura projetava atraso futuro — navegar para
       * setembro em 25/08 trazia um item que vence 30/08.
       */
      priorOverdueReceivable: number
      priorOverdueDebt: number
      receivableTotal: number
      debtTotal: number
      /** `receivableTotal - debtTotal`. Informativo, sem compensação. */
      net: number
      /** `priorOverdueReceivable - priorOverdueDebt`. Zero = nada de antes. */
      priorOverdueNet: number
      /**
       * Itens abertos.
       *
       * Saldo zero não é quitação: R$ 200 de cada lado dá `net: 0` com dois
       * itens em aberto. É esta contagem que autoriza dizer "Nada em aberto".
       */
      itemCount: number
      /**
       * Existe item VENCIDO em aberto, de qualquer lado.
       *
       * Urgência, não direção: um saldo negativo dentro do prazo não é
       * atraso, e um saldo positivo com cobrança vencida é.
       */
      hasOverdue: boolean
      automaticReceivable: number
    }
  }>
  /**
   * A Receber no mês — INFORMATIVO.
   *
   * Não entra em `totalToPay`. Recebível é dinheiro esperado, não pagamento
   * já feito de uma dívida: subtraí-lo seria afirmar uma compensação que o
   * Cartero não executa ao quitar.
   */
  receivables: {
    dueInMonth: number
    count: number
  }
  /**
   * De onde vem o total — a composição exibida sob o número.
   *
   * Os quatro componentes fecham exatamente com `totalToPay`, por construção
   * no backend. O frontend só formata os maiores que zero.
   */
  breakdown: {
    invoices: number
    directPayments: number
    /** Só dívidas SEM pessoa — as com pessoa vão em `peopleSettlements`. */
    debts: number
    /** Σ `max(dívidas − recebíveis, 0)` por pessoa. */
    peopleSettlements: number
  }
  /** `breakdown.invoices + directPayments + debts + peopleSettlements`. */
  totalToPay: number
  totalPaid: number
  totalPending: number
  invoices: BudgetInvoice[]
  /**
   * Dívidas do mês, linha a linha.
   *
   * `offset` foi REMOVIDO: não existe compensação a expor. O `amount` de uma
   * pessoa é o valor íntegro das dívidas dela.
   */
  debtBreakdown: Array<{
    kind: 'person' | 'debt'
    id: string | null
    name: string
    amount: number
    isPaid: boolean
    /** Numa pessoa com várias dívidas, atraso domina o status. */
    status: 'PAID' | 'OVERDUE' | 'PENDING'
  }>
}

export async function getBudget(params: { month: number; year: number }): Promise<BudgetSummary> {
  const { data } = await api.get<BudgetSummary>('/budget', { params })
  return data
}

/** Mês que o orçamento deve abrir: o mais antigo com algo ainda a pagar. */
export async function getBudgetFocus(): Promise<{ month: number; year: number }> {
  const { data } = await api.get<{ month: number; year: number }>('/budget/focus')
  return data
}
