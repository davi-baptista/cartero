import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
  ── A semântica do interruptor ──

  A tela fala em "mostrar"; o código, em `hideAmounts`. Os dois são opostos,
  e a inversão é onde o erro cabe: um `onValueChange` que passasse o valor
  adiante sem negar faria o switch LIGADO gravar "ocultar". A pessoa marcaria
  "mostrar valores", veria o widget mascarar, e nada apareceria como erro.

  Não montamos o React Native aqui — o projeto testa lógica, não árvore de
  componentes (ver `vitest.config.mts`). A propriedade que importa é textual
  e específica: qual expressão chega ao serviço e o que o switch exibe.
*/

const SETTINGS = readFileSync(
  join(import.meta.dirname, '..', '..', 'app', '(app)', 'settings.tsx'),
  'utf-8',
)

describe('semântica do switch de privacidade', () => {
  it('ligar o switch grava hideAmounts = false', () => {
    /*
      `setHideAmounts(ownerId, !nextShow)` — a negação é o ponto. Sem ela,
      "mostrar valores" ligado gravaria "ocultar", e a tela afirmaria o
      oposto do que o widget faz.
    */
    expect(SETTINGS).toContain('setHideAmounts(ownerId, !nextShow)')
  })

  it('o switch exibe o inverso de hideAmounts', () => {
    // O que ficou PERSISTIDO decide o que a tela mostra.
    expect(SETTINGS).toContain('showAmounts: !result.hideAmounts')
    expect(SETTINGS).toContain('showAmounts: !hideAmounts')
  })

  it('a tela reflete o persistido, não o pedido', () => {
    /*
      Estado otimista faria a interface dizer "visível" enquanto o arquivo diz
      o contrário — e, no caso de ocultar, essa mentira é o oposto de uma
      garantia de privacidade.
    */
    expect(SETTINGS).toContain('result.status')
    expect(SETTINGS).toMatch(/result\.status === 'failed'/)
  })

  it('o estado inicial é seguro: desligado e em carregamento', () => {
    /*
      Mostrar o switch ligado durante a leitura revelaria a escolha da conta
      anterior por uma fração de segundo — e sugeriria valores visíveis antes
      de alguém confirmar isso.
    */
    expect(SETTINGS).toContain("status: 'loading'")
    expect(SETTINGS).toContain(
      "const showAmounts = toggle.status === 'loading' ? false : toggle.showAmounts",
    )
  })

  it('mudanças concorrentes ficam bloqueadas durante a gravação', () => {
    // ON/OFF/ON rápido produziria escritas fora de ordem.
    expect(SETTINGS).toContain("status: 'saving'")
    expect(SETTINGS).toContain('disabled={busy}')
  })

  it('a acessibilidade fala em "mostrar", sem dupla negação', () => {
    /*
      "Ocultar valores: desativado" obrigaria quem ouve a inverter duas vezes
      para entender o estado. O rótulo acompanha como a pessoa pensa.
    */
    expect(SETTINGS).toContain(
      'accessibilityLabel="Mostrar valores nos widgets"',
    )
    expect(SETTINGS).toContain('checked: showAmounts')
    expect(SETTINGS).not.toMatch(/accessibilityLabel="Ocultar/)
  })

  it('a tela não exibe nenhum valor financeiro', () => {
    /*
      É uma preferência, não um preview. Renderizar o Budget aqui exporia na
      própria tela de privacidade o que ela existe para esconder.
    */
    for (const proibido of [
      'totalToPay',
      'totalPaid',
      'totalPending',
      'Cents',
      'R$',
      'budget',
    ]) {
      expect(SETTINGS, `a tela cita ${proibido}`).not.toContain(proibido)
    }
  })

  it('a mensagem de erro não vaza detalhe técnico', () => {
    expect(SETTINGS).toContain('Não foi possível atualizar a privacidade')

    for (const tecnico of [
      'IOException',
      'ownerId}',
      'JSON',
      'no_backup',
      'stack',
    ]) {
      expect(SETTINGS, `a copy cita ${tecnico}`).not.toContain(tecnico)
    }
  })

  it('a tela não grava JSON por conta própria', () => {
    /*
      A UI pede uma mudança ao serviço e recebe o que ficou persistido.
      Escrever direto criaria uma segunda autoridade sobre a mesma
      preferência — e duas autoridades divergem.
    */
    expect(SETTINGS).not.toContain('writePrivacy')
    expect(SETTINGS).not.toContain('readPrivacy')
    expect(SETTINGS).not.toContain('JSON.stringify')
    expect(SETTINGS).not.toContain('snapshotStore')

    // Toda mudança passa pelo serviço.
    expect(SETTINGS).toMatch(/privacy\s*\n?\s*\.getHideAmounts\(|privacy\.getHideAmounts\(/)
    expect(SETTINGS).toContain('setHideAmounts(ownerId, !nextShow)')
  })
})
