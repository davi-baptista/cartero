import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_HIDE_AMOUNTS,
  SNAPSHOT_VERSION,
  buildSignedOutSnapshot,
  parseSnapshot,
  toCents,
} from './snapshot'
import { currentCarteroCompetence } from './competence'

/*
  ── O contrato que o widget vai ler ──

  O widget é um processo separado, de execução curta, sem sessão: ele abre
  este arquivo e desenha. Não pode crashar por conteúdo inesperado nem exibir
  um número que ninguém calculou.

  Duas propriedades quebram em silêncio e por isso são vigiadas aqui:

  1. O arquivo fica em disco no aparelho. Qualquer campo que entre nele é
     superfície permanente — e "só mais um campo" é como um snapshot de quatro
     números vira uma cópia da resposta da API.

  2. Um leitor de V1 pode encontrar V2 escrito por um app mais novo. Ler
     "na dúvida" produziria valores errados na tela inicial, sem erro visível.
*/

const READY = {
  version: 1,
  state: 'ready',
  generatedAt: '2026-09-14T12:00:00.000Z',
  ownerId: 'user-a',
  privacy: { hideAmounts: true },
  budget: {
    month: 9,
    year: 2026,
    currency: 'BRL',
    totalToPayCents: 75724,
    totalPaidCents: 44624,
    totalPendingCents: 31100,
  },
}

describe('contrato do Snapshot V1', () => {
  it('S1: READY válido é lido', () => {
    const parsed = parseSnapshot(JSON.stringify(READY))

    expect(parsed).toMatchObject({
      version: 1,
      state: 'ready',
      ownerId: 'user-a',
      budget: { month: 9, year: 2026, totalToPayCents: 75724 },
    })
  })

  it('S2: signedOut válido é lido', () => {
    const parsed = parseSnapshot(
      JSON.stringify(buildSignedOutSnapshot(new Date('2026-09-14T12:00:00Z'))),
    )

    expect(parsed).toMatchObject({ version: 1, state: 'signedOut' })
  })

  it('S3: versão desconhecida é recusada, nunca lida como V1', () => {
    /*
      O widget instalado pode ser mais velho que o app. Interpretar campos de
      um formato que ele não conhece é como um número errado chega à tela
      inicial sem nenhum erro aparecer.
    */
    const futuro = { ...READY, version: 2 }

    expect(parseSnapshot(JSON.stringify(futuro))).toBeNull()
    expect(parseSnapshot(JSON.stringify({ ...READY, version: 0 }))).toBeNull()
    expect(parseSnapshot(JSON.stringify({ ...READY, version: '1' }))).toBeNull()
  })

  it('S4: JSON corrompido não derruba o leitor', () => {
    // O truncado é o caso real: escrita interrompida por morte do processo.
    expect(parseSnapshot('{"version":1,"state":"rea')).toBeNull()
    expect(parseSnapshot('')).toBeNull()
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot('[]')).toBeNull()
    expect(parseSnapshot('"texto"')).toBeNull()
  })

  it('S5: READY sem campo obrigatório é inválido', () => {
    const semCampo = (drop: string) => {
      const copy = structuredClone(READY) as Record<string, unknown>
      const budget = copy.budget as Record<string, unknown>
      if (drop in budget) delete budget[drop]
      else delete copy[drop]
      return parseSnapshot(JSON.stringify(copy))
    }

    for (const campo of [
      'ownerId',
      'privacy',
      'budget',
      'month',
      'year',
      'currency',
      'totalToPayCents',
      'totalPaidCents',
      'totalPendingCents',
    ]) {
      expect(semCampo(campo), `campo ${campo}`).toBeNull()
    }
  })

  it('S5b: centavos precisam ser inteiros', () => {
    const fracionado = structuredClone(READY)
    fracionado.budget.totalToPayCents = 757.24

    expect(parseSnapshot(JSON.stringify(fracionado))).toBeNull()
  })

  it('S6: signedOut não carrega budget nem dono', () => {
    const neutro = buildSignedOutSnapshot()

    expect(neutro).not.toHaveProperty('budget')
    expect(neutro).not.toHaveProperty('ownerId')
    expect(neutro).not.toHaveProperty('privacy')
    expect(Object.keys(neutro).sort()).toEqual([
      'generatedAt',
      'state',
      'version',
    ])
  })

  it('S7: a superfície do READY é fechada — nada além do contrato', () => {
    /*
      Asserção sobre o conjunto INTEIRO de chaves, não sobre ausências
      escolhidas a dedo. Uma verificação de "não tem token" passaria enquanto
      alguém acrescenta `salary` ou `invoices` ao lado.
    */
    const parsed = parseSnapshot(JSON.stringify(READY))!

    expect(Object.keys(parsed).sort()).toEqual([
      'budget',
      'generatedAt',
      'ownerId',
      'privacy',
      'state',
      'version',
    ])
    expect(Object.keys((parsed as never as typeof READY).budget).sort()).toEqual([
      'currency',
      'month',
      'totalPaidCents',
      'totalPendingCents',
      'totalToPayCents',
      'year',
    ])
  })

  it('S7b: campos extras no arquivo não sobrevivem à leitura', () => {
    const contaminado = {
      ...READY,
      accessToken: 'nao-deveria-estar-aqui',
      email: 'davi@cartero.app',
      salary: 5000,
    }

    const parsed = parseSnapshot(JSON.stringify(contaminado))!
    const texto = JSON.stringify(parsed)

    expect(texto).not.toContain('accessToken')
    expect(texto).not.toContain('@')
    expect(texto).not.toContain('salary')
  })

  it('S8: valores ocultos são o padrão', () => {
    /*
      A tela inicial é vista por quem passa ao lado. Quem não sabe que a
      preferência existe não deve descobrir com o saldo já exposto.
    */
    expect(DEFAULT_HIDE_AMOUNTS).toBe(true)
  })

  it('o contrato aceita os dois valores de privacidade', () => {
    const visivel = structuredClone(READY)
    visivel.privacy.hideAmounts = false

    expect(parseSnapshot(JSON.stringify(visivel))).toMatchObject({
      privacy: { hideAmounts: false },
    })
  })

  it('a versão do formato é 1', () => {
    expect(SNAPSHOT_VERSION).toBe(1)
  })
})

/* ═══════════════ S9–S13: serialização monetária ═══════════════ */

describe('reais → centavos', () => {
  it('S9–S12: converte os valores do contrato', () => {
    expect(toCents(0)).toBe(0)
    expect(toCents(0.01)).toBe(1)
    expect(toCents(1)).toBe(100)
    expect(toCents(446.24)).toBe(44624)
    expect(toCents(311)).toBe(31100)
    expect(toCents(757.24)).toBe(75724)
  })

  it('valores grandes plausíveis não perdem precisão', () => {
    expect(toCents(1234567.89)).toBe(123456789)
  })

  it('absorve o erro de ponto flutuante em vez de propagá-lo', () => {
    /*
      `19.99 * 100` dá 1998.9999999999998 em IEEE-754. Sem arredondar, o
      arquivo levaria esse valor para outro processo — e o erro passaria a
      existir fora do app, onde ninguém o corrige.
    */
    expect(toCents(19.99)).toBe(1999)
    expect(toCents(0.29)).toBe(29)
    expect(Number.isInteger(toCents(8.35))).toBe(true)
  })

  it('S13: recusa o que não é número finito', () => {
    for (const invalido of [NaN, Infinity, -Infinity]) {
      expect(() => toCents(invalido)).toThrowError()
    }

    expect(() => toCents(undefined as never)).toThrowError()
    expect(() => toCents('757.24' as never)).toThrowError()
  })

  it('negativo é preservado, não recusado', () => {
    /*
      O backend não garante não-negatividade em todo campo, e inventar essa
      invariante aqui faria o app recusar um número legítimo. Serialização
      converte; quem decide o domínio é o backend.
    */
    expect(toCents(-12.5)).toBe(-1250)
  })
})

/* ═══════════════ S14–S17: competência ═══════════════ */

describe('competência corrente (America/Fortaleza)', () => {
  it('S14: um instante comum resolve o mês civil de Fortaleza', () => {
    expect(currentCarteroCompetence(new Date('2026-09-14T15:00:00Z'), 'America/Fortaleza')).toEqual({
      month: 9,
      year: 2026,
    })
  })

  it('S17: UTC já virou o mês, Fortaleza ainda não', () => {
    /*
      01/10 às 01h UTC é 30/09 às 22h em Fortaleza (UTC−3). A competência
      ainda é SETEMBRO — e é este caso que mata uma implementação baseada em
      UTC ou no fuso do aparelho.
    */
    expect(currentCarteroCompetence(new Date('2026-10-01T01:00:00Z'), 'America/Fortaleza')).toEqual({
      month: 9,
      year: 2026,
    })
  })

  it('S15: a virada acontece na hora certa, não antes nem depois', () => {
    // 30/09 23h59 em Fortaleza = 01/10 02h59 UTC.
    expect(currentCarteroCompetence(new Date('2026-10-01T02:59:00Z'), 'America/Fortaleza')).toEqual({
      month: 9,
      year: 2026,
    })

    // 01/10 00h00 em Fortaleza = 01/10 03h00 UTC.
    expect(currentCarteroCompetence(new Date('2026-10-01T03:00:00Z'), 'America/Fortaleza')).toEqual({
      month: 10,
      year: 2026,
    })
  })

  it('S16: a virada de ANO segue a mesma régua', () => {
    // 01/01/2027 01h UTC ainda é 31/12/2026 em Fortaleza.
    expect(currentCarteroCompetence(new Date('2027-01-01T01:00:00Z'), 'America/Fortaleza')).toEqual({
      month: 12,
      year: 2026,
    })

    expect(currentCarteroCompetence(new Date('2027-01-01T03:00:00Z'), 'America/Fortaleza')).toEqual({
      month: 1,
      year: 2027,
    })
  })

  it('a competência vem de Fortaleza, não do fuso do aparelho', () => {
    /*
      ── Por que este teste é construído assim ──

      Uma asserção com data fixa só discrimina se a máquina de teste estiver
      num fuso diferente de UTC−3 — e a máquina de desenvolvimento está em
      America/Sao_Paulo, que tem exatamente o mesmo offset. Um teste assim
      passaria mesmo com `now.getMonth()`, que é a implementação errada.

      A prova precisa ser independente do host: procura-se um instante em que
      o fuso LOCAL e Fortaleza discordem. Onde eles coincidem (UTC−3), o teste
      compara contra `Intl` com o fuso declarado, que é a autoridade que a
      implementação deve usar.
    */
    const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const fortalezaParts = (instant: Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Fortaleza',
        year: 'numeric',
        month: '2-digit',
      }).format(instant)

    // Varre a virada de cada mês procurando divergência com o fuso local.
    let divergiu = false
    for (let mes = 0; mes < 12; mes += 1) {
      const virada = new Date(Date.UTC(2026, mes, 1, 1, 0, 0))
      const localMonth = virada.getMonth() + 1
      const carteroMonth = currentCarteroCompetence(virada, 'America/Fortaleza').month

      if (localMonth !== carteroMonth) {
        divergiu = true
        // Onde discordam, a resposta tem de ser a de Fortaleza.
        expect(fortalezaParts(virada)).toContain(
          String(carteroMonth).padStart(2, '0'),
        )
      }
    }

    /*
      Se o host compartilha o offset de Fortaleza, nenhuma divergência aparece
      — e a asserção acima seria vacuamente verdadeira. Neste caso o que se
      exige é que a função concorde com `Intl` em America/Fortaleza para TODAS
      as viradas, e não por coincidência de offset.
    */
    if (!divergiu) {
      for (let mes = 0; mes < 12; mes += 1) {
        const virada = new Date(Date.UTC(2026, mes, 1, 1, 0, 0))
        const [ano, mesFortaleza] = fortalezaParts(virada).split('-')

        expect(currentCarteroCompetence(virada, 'America/Fortaleza')).toEqual({
          month: Number(mesFortaleza),
          year: Number(ano),
        })
      }
    }

    expect(typeof localZone).toBe('string')
  })

  it('a implementação declara o fuso do Cartero explicitamente', () => {
    /*
      Verificação estrutural, porque a comportamental não discrimina num host
      UTC−3: o fuso precisa estar ESCRITO no código. Trocar por
      `now.getMonth()` remove a declaração e mata este teste em qualquer
      máquina, inclusive nesta.
    */
    const fonte = readFileSync(
      join(import.meta.dirname, 'competence.ts'),
      'utf-8',
    )

    expect(fonte).toContain('America/Fortaleza')
    expect(fonte).toContain('timeZone')
    // A leitura do relógio local não pode decidir a competência.
    expect(fonte).not.toMatch(/now\.getMonth\(\)/)
    expect(fonte).not.toMatch(/now\.getFullYear\(\)/)
  })
})
