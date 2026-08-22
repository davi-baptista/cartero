import { formatCurrency } from '@/lib/formatters'
import type { PersonSummary } from '@/types'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Apresentação do consolidado de uma pessoa
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Fonte única para o drawer, o PDF e o WhatsApp. Antes cada um montava seu
 * próprio texto a partir do `netBalance`, e a mensagem do WhatsApp dizia
 * "Estamos quites nesse período — nada pendente! 🎉" sempre que o saldo dava
 * zero — inclusive com R$ 500 pendentes de cada lado, quando é falso.
 *
 * A regra que atravessa este arquivo: **saldo zero não é quitação**. Só
 * `isFullySettled` (as duas contagens em zero) autoriza linguagem de
 * "tudo resolvido".
 */

export type BalanceDirection = 'receive' | 'pay' | 'settled' | 'offset'

/**
 * Em que situação a relação está.
 *
 * `offset` é o estado que não existia: saldo líquido zero COM pendências
 * abertas dos dois lados. Sem ele, o zero matemático era indistinguível de
 * "não há nada pendente".
 */
export function balanceDirection(summary: PersonSummary): BalanceDirection {
  if (summary.isFullySettled) return 'settled'
  if (Math.abs(summary.netBalance) < 0.005) return 'offset'
  return summary.netBalance > 0 ? 'receive' : 'pay'
}

/** Rótulo curto do saldo, para o card do drawer e o cabeçalho do PDF. */
export function balanceLabel(summary: PersonSummary): string {
  switch (balanceDirection(summary)) {
    case 'settled':
      return 'Tudo acertado'
    case 'offset':
      return 'Saldo líquido zerado'
    case 'receive':
      return 'Saldo a receber'
    case 'pay':
      return 'Saldo a pagar'
  }
}

/**
 * Frase que explica o saldo para quem está lendo.
 *
 * O caso `offset` diz explicitamente que existem pendências, porque o número
 * grande na tela é R$ 0,00 e sozinho ele mente.
 */
export function balanceSentence(
  summary: PersonSummary,
  personName: string,
): string {
  const value = formatCurrency(Math.abs(summary.netBalance))

  switch (balanceDirection(summary)) {
    case 'settled':
      return 'Nenhuma pendência em aberto'
    case 'offset':
      return `Os valores se compensam, mas ${pendingPhrase(summary)} em aberto`
    case 'receive':
      return `${personName} deve ${value} a você`
    case 'pay':
      return `Você deve ${value} a ${personName}`
  }
}

/** "2 dívidas e 1 cobrança" — só menciona o que existe. */
export function pendingPhrase(summary: PersonSummary): string {
  const parts: string[] = []

  if (summary.pendingDebtsCount > 0) {
    parts.push(
      summary.pendingDebtsCount === 1
        ? '1 dívida'
        : `${summary.pendingDebtsCount} dívidas`,
    )
  }
  if (summary.pendingReceivablesCount > 0) {
    parts.push(
      summary.pendingReceivablesCount === 1
        ? '1 cobrança'
        : `${summary.pendingReceivablesCount} cobranças`,
    )
  }

  if (parts.length === 0) return 'nenhuma pendência'
  return parts.join(' e ')
}

/**
 * Mensagem de WhatsApp — factual, com a composição à vista.
 *
 * Nunca reduz a relação ao saldo líquido. "Você me deve R$ 300" quando há
 * R$ 500 a receber e R$ 200 a pagar afirmaria que o app fez um encontro de
 * contas entre obrigações separadas; ele não fez, e sugerir isso numa
 * mensagem que a outra pessoa vai ler é pior do que impreciso.
 *
 * Quando o usuário é o devedor, não há cobrança a fazer: o texto vira
 * reconhecimento, não pedido.
 */
export function buildWhatsAppMessage(
  summary: PersonSummary,
  personName: string,
): string {
  const receivable = formatCurrency(summary.receivablePending)
  const debt = formatCurrency(summary.debtPending)
  const greeting = `Oi, ${personName}!`

  switch (balanceDirection(summary)) {
    case 'settled':
      // Só aqui a frase é verdadeira.
      return [greeting, '', 'Não temos nada pendente entre nós. 🙂'].join('\n')

    case 'receive':
      return summary.debtPending > 0
        ? [
            greeting,
            '',
            `Passando o nosso resumo: tenho ${receivable} a receber e ${debt} a pagar.`,
            `Saldo líquido: *${formatCurrency(summary.netBalance)}* a meu favor.`,
            '',
            'Cada item continua valendo pelo próprio valor — o saldo é só pra facilitar a conversa.',
          ].join('\n')
        : [
            greeting,
            '',
            `Você tem *${receivable}* pendente comigo (${pendingPhrase(summary)}).`,
          ].join('\n')

    case 'pay':
      /*
        O usuário é quem deve. Linguagem de cobrança aqui seria absurda —
        estaria cobrando a si mesmo.
      */
      return summary.receivablePending > 0
        ? [
            greeting,
            '',
            `Passando o nosso resumo: tenho ${debt} a pagar e ${receivable} a receber.`,
            `Saldo líquido: *${formatCurrency(Math.abs(summary.netBalance))}* a seu favor.`,
            '',
            'Cada item continua valendo pelo próprio valor.',
          ].join('\n')
        : [
            greeting,
            '',
            `Estou te devendo *${debt}* (${pendingPhrase(summary)}).`,
            'Já deixei anotado por aqui.',
          ].join('\n')

    case 'offset':
      /*
        O caso que motivou este arquivo. Nada de "estamos quites": os valores
        se anulam na conta, mas as obrigações continuam abertas.
      */
      return [
        greeting,
        '',
        `Nosso resumo: ${receivable} a receber e ${debt} a pagar — o saldo líquido fica em ${formatCurrency(0)}.`,
        `Mesmo assim ainda ${pendingPhrase(summary)} em aberto de cada lado.`,
      ].join('\n')
  }
}

/**
 * Normaliza o telefone para o formato que o `wa.me` aceita.
 *
 * Devolve `null` quando o número não é utilizável, e quem chama NÃO deve abrir
 * link nesse caso. Antes a função só removia não-dígitos e prefixava `55`:
 * digitar "123" produzia `wa.me/55123`, um link silenciosamente quebrado.
 *
 * O produto assume números brasileiros. Um telefone nacional válido tem DDD
 * (2) + número (8 fixo ou 9 celular) = 10 ou 11 dígitos; com o código do país
 * são 12 ou 13. Não é validação de operadora — é o suficiente para não gerar
 * URL inválida.
 */
export function normalizeWhatsAppPhone(
  phone: string | null | undefined,
): string | null {
  if (!phone) return null

  const digits = phone.replace(/\D/g, '')

  /*
    O prefixo é decidido pelo COMPRIMENTO, não por começar com "55".

    O DDD 55 existe (região de Santa Maria, no Rio Grande do Sul). Um
    `(55) 99999-9999` tem 11 dígitos e começa com 55: tratá-lo como
    "código do país + nacional" deixaria 9 dígitos e reprovaria um número
    perfeitamente válido. Já 12 ou 13 dígitos só fecham a conta se os dois
    primeiros forem mesmo o código do país.
  */
  if (digits.length === 12 || digits.length === 13) {
    return digits.startsWith('55') ? digits : null
  }

  // Sem código do país: DDD (2) + 8 dígitos (fixo) ou 9 (celular).
  if (digits.length === 10 || digits.length === 11) return `55${digits}`

  return null
}
