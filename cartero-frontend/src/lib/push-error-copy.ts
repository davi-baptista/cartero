/**
 * Copy para falhas ao ativar notificações push.
 *
 * O erro real reproduzido em produção foi, no Brave:
 *
 *   `Registration failed - push service error`
 *
 * com `Use Google services for push messaging` desativado. Habilitar a opção
 * resolveu — a inscrição foi criada e o push chegou. Mas a mensagem que o
 * Cartero exibia era essa string crua: nomeia um subsistema que o usuário não
 * conhece e não diz o que fazer.
 *
 * A mensagem de `DOMException` NÃO é contrato padronizado da Web. Por isso o
 * hint específico do Brave exige DUAS evidências independentes — o browser ser
 * Brave E o erro ter assinatura de falha do transporte de push. Só a string
 * levaria a instruir sobre configuração do Brave em qualquer navegador; só o
 * browser levaria a culpar o transporte por um erro de permissão.
 */

export type PushErrorKind =
  | 'permission-denied'
  | 'brave-push-service'
  | 'push-service'
  | 'unsupported'
  | 'generic'

export interface PushErrorContext {
  isBrave: boolean
  permission: NotificationPermission
}

/**
 * Assinatura de falha no transporte de push.
 *
 * Casa a mensagem do erro, não o nome da classe: navegadores diferentes
 * embrulham a mesma condição em `DOMException`, `AbortError` ou `Error`. As
 * variações conhecidas dizem "push service error" ou "Registration failed".
 */
function isPushServiceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const normalized = message.toLowerCase()

  return (
    normalized.includes('push service') ||
    normalized.includes('registration failed')
  )
}

export function classifyPushError(
  error: unknown,
  context: PushErrorContext,
): PushErrorKind {
  const message = error instanceof Error ? error.message : String(error ?? '')

  /**
   * Permissão negada tem tratamento próprio e vem primeiro: é decisão do
   * usuário, não falha de transporte. Tratá-la como problema do Brave mandaria
   * mexer numa configuração que não é a causa.
   */
  if (
    context.permission === 'denied' ||
    message === 'Permissão de notificação negada'
  ) {
    return 'permission-denied'
  }

  if (message === 'Notificações push não são suportadas neste navegador') {
    return 'unsupported'
  }

  if (isPushServiceError(error)) {
    return context.isBrave ? 'brave-push-service' : 'push-service'
  }

  return 'generic'
}

const COPY: Record<PushErrorKind, string> = {
  'permission-denied':
    'As notificações estão bloqueadas nas permissões deste site. Libere-as nas configurações do navegador e tente de novo.',
  /**
   * Descreve a configuração pelo que ela faz, com o rótulo entre aspas para
   * quem for procurá-lo. Não depende do texto exato da interface do Brave, que
   * muda entre versões e idiomas.
   */
  'brave-push-service':
    'O Brave não conseguiu registrar as notificações. Ative “Usar serviços do Google para mensagens push” nas configurações de privacidade do Brave e tente de novo.',
  'push-service':
    'O navegador não conseguiu registrar as notificações neste dispositivo. Verifique as permissões e tente de novo.',
  unsupported: 'Este navegador não suporta notificações push.',
  generic:
    'Não foi possível ativar as notificações neste navegador. Verifique as permissões e tente de novo.',
}

/** Mensagem exibida ao usuário. Nunca a string crua do erro. */
export function pushErrorMessage(
  error: unknown,
  context: PushErrorContext,
): string {
  return COPY[classifyPushError(error, context)]
}
