/**
 * Estado do toggle de notificações — verdade do DEVICE ATUAL.
 *
 * A versão anterior derivava o toggle de `!!localSubscription`: "existe uma
 * PushSubscription no PushManager deste browser?". Essa pergunta não é a que o
 * controle faz. O backend remove a linha correspondente quando o push service
 * responde `404/410` — e esse ramo não loga nada —, então o browser podia
 * manter a inscrição local enquanto o servidor já não tinha para onde enviar.
 * A UI exibia "ativado" indefinidamente, e nenhum push chegava.
 *
 * ON exige as duas pontas concordando sobre o MESMO endpoint.
 */

export type PushToggleState =
  /** Reconciliação em andamento — nunca afirmar ON antes de terminar. */
  | 'checking'
  | 'on'
  | 'off'
  /** Local presente, backend sem o registro: precisa de reativação. */
  | 'mismatch'
  /** Permissão negada no browser: reativar não é possível daqui. */
  | 'blocked'
  /** Browser sem suporte a Web Push. */
  | 'unsupported'

export interface PushToggleInput {
  supported: boolean
  permission: NotificationPermission
  /** Endpoint da inscrição local, ou `null` se o PushManager não tem nenhuma. */
  localEndpoint: string | null
  /** Resposta de `POST /notifications/subscription-status`, ou `null` se ainda
   *  não foi consultada (ou não precisava ser). */
  backendRegistered: boolean | null
  /** `true` enquanto a reconciliação não terminou. */
  checking: boolean
}

export function pushToggleState(input: PushToggleInput): PushToggleState {
  if (!input.supported) return 'unsupported'
  if (input.checking) return 'checking'

  /**
   * `denied` vem antes da inscrição local: mesmo com uma inscrição válida
   * registrada, o browser não exibirá nada. Dizer ON seria prometer entrega
   * que o sistema operacional já recusou.
   */
  if (input.permission === 'denied') return 'blocked'

  // CASE A / D — sem inscrição local, o device não está registrado. Outro
  // device do mesmo usuário não liga este toggle.
  if (input.localEndpoint === null) return 'off'

  // Local presente mas backend ainda não consultado: não afirmar nada.
  if (input.backendRegistered === null) return 'checking'

  // CASE B — as duas pontas concordam.
  if (input.backendRegistered) return 'on'

  // CASE C — local presente, backend sem registro.
  return 'mismatch'
}

/** O que o `checked` do controle deve mostrar. Só `on` é verdadeiro. */
export function isToggleChecked(state: PushToggleState): boolean {
  return state === 'on'
}

/** O controle fica inerte enquanto não há verdade para exibir. */
export function isToggleDisabled(
  state: PushToggleState,
  busy: boolean,
): boolean {
  return busy || state === 'checking' || state === 'unsupported'
}

/**
 * Texto auxiliar sob o controle. `null` quando não há nada a dizer — o estado
 * normal não ganha aviso.
 */
export function pushToggleHint(state: PushToggleState): string | null {
  switch (state) {
    case 'unsupported':
      return 'Este navegador não suporta notificações push.'
    case 'blocked':
      return 'As notificações estão bloqueadas nas permissões deste site. Libere-as nas configurações do navegador para ativar.'
    case 'mismatch':
      return 'O registro deste dispositivo expirou. Ative novamente para voltar a receber avisos.'
    case 'checking':
    case 'on':
    case 'off':
      return null
  }
}

/**
 * Uma inscrição local que o backend não reconhece precisa ser DESCARTADA antes
 * de criar outra.
 *
 * Reenviá-la ao backend (`blind re-upsert`) ressuscitaria justamente o endpoint
 * que o push service pode ter invalidado com `404/410` — o servidor voltaria a
 * tentar entregar num destino morto, e o toggle mostraria ON sem nenhum push
 * chegando. Descartar e pedir uma nova ao PushManager é o único caminho que
 * converge para um registro que de fato entrega.
 */
export function shouldDiscardLocalBeforeEnabling(
  state: PushToggleState,
): boolean {
  return state === 'mismatch'
}

/**
 * Resultado de uma tentativa de ativação, como a UI deve publicá-lo.
 *
 * Existe como função pura porque a regra crítica — nunca deixar half-enabled —
 * é uma decisão, não um efeito. Dentro do componente ela só seria verificável
 * com DOM, e a suíte deste projeto é de lógica pura.
 */
export interface EnableOutcomeInput {
  /** `pushManager.subscribe` concluiu. */
  localCreated: boolean
  /** `POST /notifications/subscribe` concluiu. */
  backendRegistered: boolean
}

export interface EnableOutcome {
  /** Precisa desfazer a inscrição local recém-criada. */
  rollbackLocal: boolean
  finalState: 'on' | 'off'
}

export function enableOutcome(input: EnableOutcomeInput): EnableOutcome {
  if (input.localCreated && input.backendRegistered) {
    return { rollbackLocal: false, finalState: 'on' }
  }

  /**
   * Inscrição local criada mas backend recusou: desfazer é obrigatório. Sem
   * isso o browser fica inscrito e o servidor sem linha — e a visita seguinte
   * leria "local presente" como ON, que é exatamente o half-enabled
   * silencioso.
   */
  return { rollbackLocal: input.localCreated, finalState: 'off' }
}
