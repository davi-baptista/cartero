import { describe, expect, it } from 'vitest'
import {
  enableOutcome,
  pushToggleState,
  isToggleChecked,
  isToggleDisabled,
  pushToggleHint,
  shouldDiscardLocalBeforeEnabling,
  type PushToggleInput,
} from './push-toggle-state'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O toggle fala do DEVICE ATUAL, não do usuário
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A versão anterior decidia por `!!localSubscription`. Isso responde "este
 * browser tem inscrição no PushManager?" — e o backend remove a linha
 * correspondente, sem logar nada, quando o push service devolve `404/410`.
 * O browser mantinha a inscrição, a UI exibia ON, e nenhum push chegava.
 *
 * Também não basta "o usuário tem alguma inscrição": desktop, celular e PWA
 * coexistem, e um Brave que nunca se registrou mostraria ON porque o Chrome do
 * desktop está.
 */

const THIS_DEVICE = 'https://fcm.googleapis.com/fcm/send/THIS'

function input(over: Partial<PushToggleInput> = {}): PushToggleInput {
  return {
    supported: true,
    permission: 'granted',
    localEndpoint: THIS_DEVICE,
    backendRegistered: true,
    checking: false,
    ...over,
  }
}

describe('estado do toggle', () => {
  it('F1: sem inscrição local → OFF', () => {
    const state = pushToggleState(
      input({ localEndpoint: null, backendRegistered: null }),
    )

    expect(state).toBe('off')
    expect(isToggleChecked(state)).toBe(false)
  })

  it('F2: local presente + backend confirma → ON', () => {
    const state = pushToggleState(input())

    expect(state).toBe('on')
    expect(isToggleChecked(state)).toBe(true)
  })

  it('F3: local presente + backend NÃO reconhece → não pode exibir ON', () => {
    /**
     * O caso central. `404/410` removeu a linha no servidor; o browser não
     * sabe disso. Exibir ON seria afirmar entrega impossível.
     */
    const state = pushToggleState(input({ backendRegistered: false }))

    expect(state).toBe('mismatch')
    expect(isToggleChecked(state)).toBe(false)
  })

  it('F4: outro device registrado, este sem inscrição local → OFF', () => {
    /**
     * O backend tem inscrição do usuário — de OUTRO browser. Este device
     * continua OFF: `count > 0` responderia errado.
     */
    const state = pushToggleState(
      input({ localEndpoint: null, backendRegistered: null }),
    )

    expect(isToggleChecked(state)).toBe(false)
  })

  it('permissão negada nunca exibe ON, mesmo com as duas pontas registradas', () => {
    const state = pushToggleState(input({ permission: 'denied' }))

    expect(state).toBe('blocked')
    expect(isToggleChecked(state)).toBe(false)
  })

  it('permissão default sem inscrição local → OFF', () => {
    const state = pushToggleState(
      input({ permission: 'default', localEndpoint: null, backendRegistered: null }),
    )

    expect(state).toBe('off')
  })

  it('durante a verificação não afirma ON', () => {
    /**
     * Evita o flash: ON no primeiro render e OFF depois da resposta do
     * servidor teria exibido, por um instante, a mentira que a fase remove.
     */
    const state = pushToggleState(input({ checking: true }))

    expect(state).toBe('checking')
    expect(isToggleChecked(state)).toBe(false)
    expect(isToggleDisabled(state, false)).toBe(true)
  })

  it('local presente e backend ainda não consultado → não afirma ON', () => {
    const state = pushToggleState(input({ backendRegistered: null }))

    expect(isToggleChecked(state)).toBe(false)
  })

  it('browser sem suporte → unsupported e controle inerte', () => {
    const state = pushToggleState(input({ supported: false }))

    expect(state).toBe('unsupported')
    expect(isToggleDisabled(state, false)).toBe(true)
  })
})

describe('reparo do estado divergente', () => {
  it('F5: mismatch exige inscrição NOVA, não a local existente', () => {
    /**
     * Reenviar a inscrição local ao backend (`blind re-upsert`) ressuscitaria
     * o endpoint que o push service pode ter invalidado — o servidor voltaria
     * a entregar num destino morto e o toggle mostraria ON sem push algum.
     */
    expect(shouldDiscardLocalBeforeEnabling('mismatch')).toBe(true)
  })

  it('estado normal não descarta a inscrição local', () => {
    expect(shouldDiscardLocalBeforeEnabling('on')).toBe(false)
    expect(shouldDiscardLocalBeforeEnabling('off')).toBe(false)
    expect(shouldDiscardLocalBeforeEnabling('checking')).toBe(false)
  })

  it('mismatch avisa que é preciso reativar', () => {
    expect(pushToggleHint('mismatch')).toMatch(/ative novamente/i)
  })

  it('bloqueado orienta sobre permissão, não sobre transporte', () => {
    const hint = pushToggleHint('blocked')

    expect(hint).toMatch(/permiss/i)
    expect(hint).not.toMatch(/brave|google/i)
  })

  it('estados normais não exibem aviso', () => {
    expect(pushToggleHint('on')).toBeNull()
    expect(pushToggleHint('off')).toBeNull()
    expect(pushToggleHint('checking')).toBeNull()
  })
})

describe('ativação como transação lógica', () => {
  it('F7: as duas pontas concluem → ON, sem rollback', () => {
    expect(enableOutcome({ localCreated: true, backendRegistered: true })).toEqual({
      rollbackLocal: false,
      finalState: 'on',
    })
  })

  it('F6: local criada + backend falhou → rollback e OFF', () => {
    /**
     * Sem o rollback o browser ficaria inscrito e o servidor sem linha. Na
     * visita seguinte "local presente" seria lido como ON — o half-enabled
     * silencioso que esta rodada elimina.
     */
    expect(enableOutcome({ localCreated: true, backendRegistered: false })).toEqual({
      rollbackLocal: true,
      finalState: 'off',
    })
  })

  it('falha antes de criar a inscrição → OFF, nada a desfazer', () => {
    expect(enableOutcome({ localCreated: false, backendRegistered: false })).toEqual({
      rollbackLocal: false,
      finalState: 'off',
    })
  })

  it('nenhum caminho de falha publica ON', () => {
    for (const localCreated of [true, false]) {
      for (const backendRegistered of [true, false]) {
        const outcome = enableOutcome({ localCreated, backendRegistered })
        if (!(localCreated && backendRegistered)) {
          expect(outcome.finalState).toBe('off')
        }
      }
    }
  })
})

describe('M3: re-upsert cego no mount é proibido', () => {
  it('mismatch NÃO é resolvido reenviando a inscrição local', () => {
    /**
     * O atalho tentador seria, no mount: "se existe inscrição local, faz POST
     * /subscribe". Isso esconderia o problema e ressuscitaria o endpoint que o
     * push service invalidou com `404/410` — o servidor voltaria a entregar
     * num destino morto.
     *
     * O contrato é CHECK → verdade → reparo explícito. O reparo exige
     * descartar a inscrição local, e é isso que esta propriedade fixa: se
     * alguém trocar o reparo por re-upsert, `shouldDiscardLocalBeforeEnabling`
     * deixará de pedir o descarte.
     */
    expect(shouldDiscardLocalBeforeEnabling('mismatch')).toBe(true)

    // E o estado divergente jamais é publicado como ON sem reparo.
    const state = pushToggleState(
      input({ backendRegistered: false }),
    )
    expect(isToggleChecked(state)).toBe(false)
  })
})

describe('F8 / multi-device: desativar afeta só este device', () => {
  it('o alvo da desativação é o endpoint DESTE browser', () => {
    /**
     * O backend recebe o endpoint local e apaga por `{ userId, endpoint }`. Um
     * `deleteMany({ userId })` removeria celular e PWA junto — por isso a UI
     * nunca desativa "o usuário", sempre um endpoint.
     */
    const deviceA = 'https://fcm.googleapis.com/fcm/send/A'
    const deviceB = 'https://fcm.googleapis.com/fcm/send/B'

    // Device A se desativa: sua inscrição local some.
    const afterDisableOnA = pushToggleState(
      input({ localEndpoint: null, backendRegistered: null }),
    )
    expect(isToggleChecked(afterDisableOnA)).toBe(false)

    // Device B continua com a sua, e o backend continua reconhecendo-a.
    const onB = pushToggleState(
      input({ localEndpoint: deviceB, backendRegistered: true }),
    )
    expect(isToggleChecked(onB)).toBe(true)

    expect(deviceA).not.toBe(deviceB)
  })

  it('device C, sem inscrição local, ignora os registros de A e B', () => {
    const stateC = pushToggleState(
      input({ localEndpoint: null, backendRegistered: null }),
    )

    expect(stateC).toBe('off')
  })
})
