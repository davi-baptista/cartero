import { describe, expect, it } from 'vitest'
import { classifyPushError, pushErrorMessage } from './push-error-copy'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Copy de falha ao ativar push
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Erro reproduzido em produção, no Brave com `Use Google services for push
 * messaging` desativado:
 *
 *   `Registration failed - push service error`
 *
 * O Cartero exibia essa string crua. Nomeia um subsistema que o usuário não
 * conhece e não diz o que fazer — e habilitar a configuração resolveu.
 *
 * O hint do Brave exige DUAS evidências: ser Brave E o erro ter assinatura de
 * falha de transporte. A mensagem de `DOMException` não é contrato Web
 * padronizado, então nenhuma das duas sozinha autoriza a instrução.
 */

const PUSH_SERVICE_ERROR = new Error('Registration failed - push service error')

describe('classificação do erro', () => {
  it('E1: Brave + erro de push service → hint específico do Brave', () => {
    const kind = classifyPushError(PUSH_SERVICE_ERROR, {
      isBrave: true,
      permission: 'granted',
    })

    expect(kind).toBe('brave-push-service')
    expect(
      pushErrorMessage(PUSH_SERVICE_ERROR, {
        isBrave: true,
        permission: 'granted',
      }),
    ).toMatch(/serviços do Google/i)
  })

  it('E2: Chrome/Edge + o MESMO erro → não instrui sobre o Brave', () => {
    /**
     * Mesma string, browser diferente: a causa provável é outra, e mandar
     * mexer em configuração do Brave num Chrome é instrução impossível.
     */
    const context = { isBrave: false, permission: 'granted' as const }

    expect(classifyPushError(PUSH_SERVICE_ERROR, context)).toBe('push-service')

    const message = pushErrorMessage(PUSH_SERVICE_ERROR, context)
    expect(message).not.toMatch(/brave/i)
    expect(message).not.toMatch(/google/i)
  })

  it('E3: Brave + erro genérico → não assume a mesma causa', () => {
    const kind = classifyPushError(new Error('Something else failed'), {
      isBrave: true,
      permission: 'granted',
    })

    expect(kind).toBe('generic')
    expect(
      pushErrorMessage(new Error('Something else failed'), {
        isBrave: true,
        permission: 'granted',
      }),
    ).not.toMatch(/google/i)
  })

  it('E4: permissão negada tem tratamento próprio', () => {
    /**
     * Decisão do usuário, não falha de transporte — vem antes da classificação
     * de push service, inclusive no Brave.
     */
    const kind = classifyPushError(PUSH_SERVICE_ERROR, {
      isBrave: true,
      permission: 'denied',
    })

    expect(kind).toBe('permission-denied')

    const message = pushErrorMessage(PUSH_SERVICE_ERROR, {
      isBrave: true,
      permission: 'denied',
    })
    expect(message).toMatch(/permiss/i)
    expect(message).not.toMatch(/google/i)
  })

  it('E4: recusa no prompt também cai em permissão', () => {
    const kind = classifyPushError(
      new Error('Permissão de notificação negada'),
      { isBrave: false, permission: 'default' },
    )

    expect(kind).toBe('permission-denied')
  })

  it('browser sem suporte tem copy própria', () => {
    const kind = classifyPushError(
      new Error('Notificações push não são suportadas neste navegador'),
      { isBrave: false, permission: 'default' },
    )

    expect(kind).toBe('unsupported')
  })

  it('variação da mensagem de transporte ainda é reconhecida', () => {
    /**
     * A string exata não é contrato: casa por assinatura, não por igualdade.
     */
    expect(
      classifyPushError(new Error('AbortError: push service error'), {
        isBrave: true,
        permission: 'granted',
      }),
    ).toBe('brave-push-service')
  })
})

describe('E5: o texto técnico nunca chega ao usuário', () => {
  const context = { isBrave: true, permission: 'granted' as const }

  it('a mensagem exibida não repete a string crua do erro', () => {
    const message = pushErrorMessage(PUSH_SERVICE_ERROR, context)

    expect(message).not.toContain('Registration failed')
    expect(message).not.toContain('push service error')
  })

  it('nenhuma copy vaza vocabulário de implementação', () => {
    const errors = [
      PUSH_SERVICE_ERROR,
      new Error('Permissão de notificação negada'),
      new Error('qualquer outra coisa'),
      new DOMException('failed', 'NotAllowedError'),
    ]

    for (const error of errors) {
      for (const isBrave of [true, false]) {
        for (const permission of ['granted', 'denied', 'default'] as const) {
          const message = pushErrorMessage(error, { isBrave, permission })

          expect(message).not.toMatch(/DOMException|PushManager|VAPID|p256dh/i)
          expect(message.length).toBeGreaterThan(20)
        }
      }
    }
  })

  it('valores não-Error não quebram a classificação', () => {
    expect(pushErrorMessage(undefined, context)).toBeTruthy()
    expect(pushErrorMessage('string solta', context)).toBeTruthy()
  })
})
