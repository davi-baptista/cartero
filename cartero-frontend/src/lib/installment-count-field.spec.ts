import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  INSTALLMENTS_MESSAGE,
  MAX_INSTALLMENTS,
  installmentsIssue,
  isEditableDraft,
  toInstallmentsPayload,
} from './installment-count-field'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Digitar 10 parcelas tem de ser possível
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O campo vinha com `2`. Selecionar, apagar e digitar `10` — o caminho
 * natural — era impossível: no primeiro Backspace o modo virava "À vista" e o
 * próprio input DESMONTAVA.
 *
 * A causa era derivar o modo do número:
 *
 *   isParcelado = (Number(installments) || 1) > 1
 *   Number('')  === 0  →  0 || 1  →  1  →  1 > 1 === false
 *
 * E o `1` não é só o campo vazio: é o primeiro caractere de 10, 12, 15, 18.
 * Qualquer regra que leia "1" como "à vista" durante a digitação quebra todos
 * esses casos.
 *
 * Agora o modo é escolha explícita, e o campo aceita rascunho. Rascunho
 * permissivo não afrouxa a regra — o submit continua exigindo >= 2.
 */

const ler = (caminho: string) =>
  readFileSync(new URL(caminho, import.meta.url), 'utf-8')

const SHEET = ler('../app/(dashboard)/transactions/transaction-sheet.tsx')
const semComentarios = SHEET.replace(/\/\*[\s\S]*?\*\//g, '').replace(
  /^\s*\/\/.*$/gm,
  '',
)

// ─── F1-F4: o rascunho durante a digitação ──────────────────────────────────

describe('F1-F4: o campo aceita os estados intermediários', () => {
  it('F2: vazio é rascunho válido', () => {
    expect(isEditableDraft('')).toBe(true)
    expect(isEditableDraft(undefined)).toBe(true)
  })

  it('F3: "1" é rascunho válido — é o começo de 10, 12, 15, 18', () => {
    expect(isEditableDraft('1')).toBe(true)
    expect(isEditableDraft('0')).toBe(true)
  })

  it('F4: a sequência 2 → "" → 1 → 10 chega a 10', () => {
    const passos = ['2', '', '1', '10']

    for (const passo of passos) {
      expect(isEditableDraft(passo), `rascunho ${JSON.stringify(passo)}`).toBe(
        true,
      )
    }

    /* Só o último é valor final; os intermediários não são recusados como
       rascunho, apenas como submit. */
    expect(installmentsIssue('10', true)).toBeNull()
    expect(toInstallmentsPayload('10', true)).toBe(10)
  })

  it('lixo não vira rascunho aceitável', () => {
    for (const v of ['abc', '1.5', '-1', '1e3', ' 2 ']) {
      expect(isEditableDraft(v), `rascunho ${JSON.stringify(v)}`).toBe(false)
    }
  })
})

// ─── F1: o MODO não depende do campo ────────────────────────────────────────

describe('F1: o modo é escolha explícita, não leitura do número', () => {
  it('a derivação antiga não existe mais no formulário', () => {
    /*
      `Number(selectedInstallments) || 1` seguido de `> 1` era a expressão
      que trocava o modo sozinha. Se voltar, este teste cai.
    */
    expect(semComentarios).not.toContain('Number(selectedInstallments) || 1')
    expect(semComentarios).not.toMatch(
      /isParcelado\s*=\s*installmentCount\s*>\s*1/,
    )
  })

  it('o modo é um CAMPO do formulário, não uma leitura do número', () => {
    /*
      Campo, e não `useState`: a regra de parcelas é contextual, então o
      resolver precisa do modo em `values`. Com estado local ele teria de ler
      um `ref` durante o render — que o React desaconselha e o lint recusa.
    */
    expect(semComentarios).toContain('parcelado: z.boolean().optional()')
    expect(semComentarios).toContain(
      "useWatch({ control, name: 'parcelado' })",
    )
  })

  it('trocar de modo é ação do usuário, e só dela', () => {
    /* O único lugar que escreve o modo é o handler do botão. */
    const escritas = semComentarios.match(/setValue\('parcelado'/g) ?? []
    expect(escritas.length).toBe(1)
    expect(semComentarios).toContain(
      'function handlePaymentModeChange(parcelado: boolean)',
    )
  })
})

// ─── F5-F9: o que o submit aceita ───────────────────────────────────────────

describe('F5-F9: a regra do valor final', () => {
  it('F5: vazio em modo Parcelado é ERRO, não compra à vista', () => {
    /*
      O schema fazia `'' → undefined` num campo `.optional()`, então submeter
      com o campo limpo passava e criava uma compra à vista — o oposto do que
      a tela mostrava. Antes era inalcançável (limpar trocava o modo); com o
      modo desacoplado virou um caminho real.
    */
    expect(installmentsIssue('', true)).toBe('required')
    expect(toInstallmentsPayload('', true)).toBeUndefined()
  })

  it('F6: 0 é rejeitado', () => {
    expect(installmentsIssue('0', true)).toBe('tooFew')
  })

  it('F7: 1 é rejeitado — parcelar em 1 não é parcelar', () => {
    expect(installmentsIssue('1', true)).toBe('tooFew')
  })

  it('F8: 2 é aceito', () => {
    expect(installmentsIssue('2', true)).toBeNull()
    expect(toInstallmentsPayload('2', true)).toBe(2)
  })

  it('F9: 10 é aceito', () => {
    expect(installmentsIssue('10', true)).toBeNull()
    expect(toInstallmentsPayload('10', true)).toBe(10)
  })

  it('decimais, negativos e texto são recusados', () => {
    expect(installmentsIssue('1.5', true)).toBe('notInteger')
    expect(installmentsIssue('-1', true)).toBe('tooFew')
    expect(installmentsIssue('abc', true)).toBe('notInteger')
  })

  it('o máximo vigente é preservado — não muda nesta fase', () => {
    expect(MAX_INSTALLMENTS).toBe(64)
    expect(installmentsIssue(String(MAX_INSTALLMENTS), true)).toBeNull()
    expect(installmentsIssue(String(MAX_INSTALLMENTS + 1), true)).toBe('tooMany')
  })
})

// ─── F10-F11: à vista continua funcionando ──────────────────────────────────

describe('F10-F11: o modo à vista', () => {
  it('F10: fora do parcelado o campo não é exigido', () => {
    for (const v of ['', undefined, '1', '0']) {
      expect(installmentsIssue(v, false), `valor ${JSON.stringify(v)}`).toBeNull()
    }
  })

  it('F10: e o payload é `undefined` — a representação canônica de à vista', () => {
    /*
      O backend trata ausente e 1 como um único lançamento
      (`resolveInstallmentCount`). Mandar `undefined` preserva essa semântica
      sem inventar um `1` que a tela nunca mostrou.
    */
    expect(toInstallmentsPayload('2', false)).toBeUndefined()
    expect(toInstallmentsPayload('', false)).toBeUndefined()
  })

  it('F11: voltar para Parcelado recomeça no default válido', () => {
    expect(semComentarios).toContain(
      "setValue('installments', parcelado ? 2 : undefined",
    )
  })
})

// ─── F12: configuração de input preservada ──────────────────────────────────

describe('F12: o input continua adequado ao mobile', () => {
  it('segue `type="number"`, sem depender de spinner', () => {
    const bloco = semComentarios.slice(
      semComentarios.indexOf("id=\"installments\""),
      semComentarios.indexOf("id=\"installments\"") + 400,
    )

    expect(bloco).toContain('type="number"')
    /* O mínimo do HTML não substitui a validação — apenas ajuda o teclado. */
    expect(bloco).toContain('max={64}')
  })

  it('as mensagens seguem o padrão curto do formulário', () => {
    for (const msg of Object.values(INSTALLMENTS_MESSAGE)) {
      expect(msg.endsWith('.')).toBe(false)
      expect(msg.length).toBeLessThan(40)
    }
    expect(INSTALLMENTS_MESSAGE.required).toBe(
      'Informe a quantidade de parcelas',
    )
    expect(INSTALLMENTS_MESSAGE.tooFew).toBe('Mínimo 2 parcelas')
  })
})

// ─── A tabela de contrato ───────────────────────────────────────────────────

describe('CONTRATO: valor final × modo × submit', () => {
  it('a matriz inteira', () => {
    const casos: Array<[unknown, boolean, boolean, number | undefined]> = [
      /* valor,  parcelado, aceita, payload */
      ['', true, false, undefined],
      ['0', true, false, undefined],
      ['1', true, false, undefined],
      ['2', true, true, 2],
      ['10', true, true, 10],
      ['', false, true, undefined],
      ['2', false, true, undefined],
    ]

    for (const [valor, parcelado, aceita, payload] of casos) {
      const rotulo = `${JSON.stringify(valor)} parcelado=${parcelado}`
      expect(installmentsIssue(valor, parcelado) === null, rotulo).toBe(aceita)
      expect(toInstallmentsPayload(valor, parcelado), rotulo).toBe(payload)
    }
  })
})
