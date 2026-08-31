import { isAxiosError } from 'axios'

/**
 * Mensagens de erro vindas da API.
 *
 * O backend recusa operações que quebrariam integridade financeira com um
 * código de domínio e uma mensagem já escrita para o usuário — por exemplo,
 * editar uma compra cujo valor já foi recebido. Mostrar "Erro ao salvar" nesses
 * casos joga fora a única informação que explica o que fazer a seguir.
 *
 * Estes helpers extraem essa mensagem quando ela existe e caem num texto
 * genérico quando não existe. O código nunca é exibido: ele serve para o
 * frontend decidir o que fazer, não para o usuário ler.
 */

interface ApiErrorBody {
  message?: string | string[]
  code?: string
}

function errorBody(error: unknown): ApiErrorBody | undefined {
  if (!isAxiosError(error)) return undefined
  return error.response?.data as ApiErrorBody | undefined
}

/** Código de domínio da recusa, quando o backend enviou um. */
export function apiErrorCode(error: unknown): string | undefined {
  return errorBody(error)?.code
}

/** Status HTTP da resposta, quando houver. */
export function apiErrorStatus(error: unknown): number | undefined {
  return isAxiosError(error) ? error.response?.status : undefined
}

/**
 * Mensagem para o usuário: a do backend quando existe, senão o fallback.
 *
 * O `ValidationPipe` do Nest devolve `message` como array quando há erros de
 * campo; nesse caso a primeira entrada é a mais específica.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const message = errorBody(error)?.message

  if (Array.isArray(message)) return message[0] ?? fallback
  if (typeof message === 'string' && message.trim().length > 0) return message

  return fallback
}

/** `true` se o erro é a recusa de domínio identificada por `code`. */
export function isApiErrorCode(error: unknown, code: string): boolean {
  return apiErrorCode(error) === code
}

/**
 * Dados que a recusa carrega além da mensagem.
 *
 * Algumas recusas explicam o estado que as causou — a exclusão de parcelas
 * devolve o plano recalculado. Ler esse campo evita uma segunda requisição
 * que, pior que redundante, poderia observar um TERCEIRO estado e explicar a
 * recusa por algo que não a causou.
 *
 * Genérico em vez de fixo no preview: quem chama declara o que espera, e o
 * helper não precisa conhecer os tipos de cada domínio.
 */
export function apiErrorDetail<T>(error: unknown, field: string): T | undefined {
  const body = errorBody(error) as Record<string, unknown> | undefined
  return body?.[field] as T | undefined
}

/**
 * Códigos de conflito que o backend usa para recusar operações que deixariam
 * dados inconsistentes. Todos vêm com mensagem própria, então a UI só precisa
 * repassá-la — a lista existe para os casos em que o fluxo muda (abrir uma
 * confirmação, por exemplo), não para reescrever o texto.
 */
export const API_ERROR_CODES = {
  /** Compra cujo A Receber já foi recebido: edição financeira bloqueada. */
  RECEIVABLE_ALREADY_PAID: 'RECEIVABLE_ALREADY_PAID',
  /** A transação registra o pagamento de uma dívida ou cobrança. */
  PAYMENT_TRANSACTION_LINKED: 'PAYMENT_TRANSACTION_LINKED',
  /** Banco com transações, faturas ou assinaturas vinculadas. */
  BANK_HAS_HISTORY: 'BANK_HAS_HISTORY',
  /** Categoria vinculada a transações ou assinaturas. */
  CATEGORY_IN_USE: 'CATEGORY_IN_USE',
  /** Remanejamento para fatura fechada: exige confirmação do usuário. */
  CLOSED_INVOICE_REASSIGNMENT: 'CLOSED_INVOICE_REASSIGNMENT',
  /** Dívida já paga: fatos financeiros travados até desfazer o pagamento. */
  PAID_DEBT_EDIT_BLOCKED: 'PAID_DEBT_EDIT_BLOCKED',
  /** Cobrança já recebida: mesma regra da dívida paga. */
  PAID_RECEIVABLE_EDIT_BLOCKED: 'PAID_RECEIVABLE_EDIT_BLOCKED',
  /**
   * Cobrança automática: é derivada da compra, que é a fonte de verdade.
   * A UI já desabilita os campos, mas o código cobre o caso de a cobrança
   * ter virado automática entre a abertura do formulário e o envio.
   */
  AUTOMATIC_RECEIVABLE_MANAGED_BY_TRANSACTION:
    'AUTOMATIC_RECEIVABLE_MANAGED_BY_TRANSACTION',
  /**
   * O que podia ser excluído mudou entre a prévia e a confirmação.
   *
   * Não é erro técnico: a confirmação do usuário valia para um conjunto que
   * já não é o atual. A tela recarrega a prévia e pede nova confirmação.
   */
  DELETE_SET_CHANGED: 'DELETE_SET_CHANGED',
  /** Nenhuma parcela da série está em aberto e livre de travas. */
  NO_DELETABLE_INSTALLMENTS: 'NO_DELETABLE_INSTALLMENTS',
} as const
