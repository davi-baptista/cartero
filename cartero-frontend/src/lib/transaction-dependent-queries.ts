import type { QueryClient } from '@tanstack/react-query'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O que depende de uma transação
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Criar, editar e excluir uma transação mexem nos mesmos fatos, e cada uma das
 * NOVE mutações espalhadas pelo app mantinha a própria lista de chaves. Elas já
 * haviam divergido em cinco variações:
 *
 *   • o Extrato invalidava `receivables` e `invoices`; o painel da fatura, não;
 *   • a criação a partir da lista de faturas esquecia `invoices` e
 *     `receivables`;
 *   • o atalho de excluir a compra de origem invalidava `persons` mas não
 *     `person-statement`;
 *   • só a exclusão de parcelas em aberto tocava nas superfícies de pessoa.
 *
 * O sintoma da última divergência era o mais visível: atribuir uma compra a
 * alguém cria uma cobrança automática para essa pessoa, e a lista de Pessoas
 * continuava mostrando o saldo antigo até o usuário recarregar a página. O
 * dado estava certo no servidor; a tela é que afirmava outra coisa.
 *
 * ── Prefixos, não chaves completas ──
 *
 * `['person-statement']` alcança `[.., personId, início, fim]` pelo casamento
 * por prefixo do React Query. Isso resolve de graça o caso mais escorregadio:
 * mover uma compra da pessoa A para a B precisa atualizar AS DUAS, e montar as
 * chaves à mão exigiria saber quais pessoas e meses estão em cache — errando
 * em silêncio ao esquecer uma.
 *
 * O mesmo vale para `['persons']`, que cobre a lista e o resumo mensal
 * (`['persons', 'monthly-summary', período]`).
 *
 * ── Deliberada, nunca `invalidateQueries()` sem filtro ──
 *
 * Limpar o cache inteiro resolveria qualquer incoerência e descartaria tudo o
 * que a página carregou corretamente, transformando cada edição numa recarga
 * disfarçada.
 */

export interface TransactionDependentScope {
  /**
   * A fatura afetada, quando conhecida.
   *
   * `null` é estado real de quem chama sem fatura selecionada, não descuido.
   */
  invoiceId?: string | null
  /** O cartão afetado, quando conhecido. */
  bankId?: string | null
  /**
   * A mutação pode ter mexido em informação de alguma pessoa.
   *
   * ── Por que não deduzimos isso aqui ──
   *
   * Só quem chama sabe: a transação tinha pessoa antes? passou a ter? trocou?
   * O helper receberia `personId` e ainda assim erraria no caso A → B, onde
   * DUAS pessoas mudam e uma delas já não está no payload.
   *
   * Na dúvida, passe `true`. Duas requisições a mais custam menos que um saldo
   * errado na tela — e o custo real é zero quando nenhuma superfície de pessoa
   * está montada, porque o React Query só refaz o que está sendo observado.
   */
  affectsPerson?: boolean
}

export function invalidateTransactionDependents(
  qc: QueryClient,
  scope: TransactionDependentScope = {},
) {
  /* A lista do Extrato, em qualquer recorte de período ou filtro. */
  qc.invalidateQueries({ queryKey: ['transactions'] })

  /*
    A fatura muda de total a cada lançamento — a aberta, a lista do cartão e a
    coleção geral. As duas primeiras só quando o chamador sabe de qual se
    trata; a última sempre, porque uma transação pode criar fatura nova.
  */
  if (scope.invoiceId) {
    qc.invalidateQueries({ queryKey: ['invoice', scope.invoiceId] })
  }
  if (scope.bankId) {
    qc.invalidateQueries({ queryKey: ['bank-invoices', scope.bankId] })
  } else {
    qc.invalidateQueries({ queryKey: ['bank-invoices'] })
  }
  qc.invalidateQueries({ queryKey: ['invoices'] })

  /* O comprometido do mês acompanha qualquer lançamento. */
  qc.invalidateQueries({ queryKey: ['budget'] })

  /*
    Cobranças automáticas são derivadas da compra: nascem, mudam de valor e
    desaparecem junto com ela.
  */
  qc.invalidateQueries({ queryKey: ['receivables'] })

  /*
    As superfícies de pessoa só quando a mutação pode tê-las tocado.

    Invalidá-las sempre custaria duas requisições em cada compra própria, que
    não altera saldo de ninguém.
  */
  if (scope.affectsPerson) {
    qc.invalidateQueries({ queryKey: ['persons'] })
    qc.invalidateQueries({ queryKey: ['person-statement'] })
  }
}

/**
 * A mutação pode ter mexido em alguma pessoa?
 *
 * Compara o antes e o depois em vez de olhar só o payload: mover uma compra de
 * A para B, ou tirar a pessoa de uma compra, muda a superfície de quem SAIU —
 * e essa pessoa não aparece no que foi enviado.
 *
 * `undefined` em `next` significa "o formulário não mencionou pessoa", que é
 * diferente de `null` ("remova a pessoa"). Só o segundo é mudança.
 */
export function transactionAffectsPerson(
  previous: string | null | undefined,
  next?: string | null,
): boolean {
  /* Já era de alguém: qualquer alteração financeira reflete no extrato dela. */
  if (previous) return true

  /* Não era de ninguém e passou a ser. */
  return Boolean(next)
}
