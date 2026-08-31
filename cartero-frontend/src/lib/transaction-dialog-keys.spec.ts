import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openDeleteDialogKey, scopeDialogKey } from './transaction-dialog-keys'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * G11 — chave duplicada no Extrato
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O warning não vinha das linhas de transação, e sim de dois DIÁLOGOS irmãos
 * que compartilhavam a sentinela `'none'` quando ociosos — o estado normal da
 * tela. Cada um estava correto sozinho; a colisão era entre eles.
 *
 * Por isso o teste central afirma unicidade ENTRE IRMÃOS, e não o formato de
 * cada key isolada: é a propriedade que o React exige e a que quebrou.
 */

/** As keys que coexistem no mesmo nível de renderização. */
const irmaos = (
  alvo: string | null,
  escopo: { mode: string; transactionId: string } | null,
) => [openDeleteDialogKey(alvo), scopeDialogKey(escopo)]

const unicas = (ks: string[]) => new Set(ks).size === ks.length

describe('K5: os dois diálogos nunca colidem', () => {
  it('ociosos — o estado em que o bug aparecia', () => {
    /* Nenhum diálogo aberto é como a tela passa a maior parte do tempo. */
    expect(unicas(irmaos(null, null))).toBe(true)
  })

  it('não reintroduz a sentinela compartilhada', () => {
    /* `'none'` nos dois foi exatamente a causa raiz. */
    expect(openDeleteDialogKey(null)).not.toBe('none')
    expect(scopeDialogKey(null)).not.toBe('none')
  })

  it('um aberto e o outro ocioso', () => {
    expect(unicas(irmaos('tx-1', null))).toBe(true)
    expect(unicas(irmaos(null, { mode: 'delete', transactionId: 'tx-1' }))).toBe(true)
  })

  it('K4: os dois apontando para a MESMA compra', () => {
    /*
      O caso mais escorregadio: sem namespace, dois diálogos sobre a mesma
      transação produziriam a mesma key mesmo com id presente.
    */
    expect(unicas(irmaos('tx-1', { mode: 'delete', transactionId: 'tx-1' }))).toBe(true)
  })
})

describe('K1/K2/K3: identidade estável por compra e operação', () => {
  it('compras diferentes remontam o diálogo', () => {
    expect(openDeleteDialogKey('tx-1')).not.toBe(openDeleteDialogKey('tx-2'))
  })

  it('a mesma compra mantém a MESMA key', () => {
    /*
      Estabilidade é metade do contrato: se a key mudasse a cada render, o
      diálogo remontaria no meio de uma confirmação e perderia a prévia.
    */
    expect(openDeleteDialogKey('tx-1')).toBe(openDeleteDialogKey('tx-1'))
    expect(scopeDialogKey({ mode: 'edit', transactionId: 'tx-1' })).toBe(
      scopeDialogKey({ mode: 'edit', transactionId: 'tx-1' }),
    )
  })

  it('trocar de operação na mesma compra remonta o escopo', () => {
    /* Editar e excluir a mesma parcela são operações distintas. */
    expect(scopeDialogKey({ mode: 'edit', transactionId: 'tx-1' })).not.toBe(
      scopeDialogKey({ mode: 'delete', transactionId: 'tx-1' }),
    )
  })

  it('a key carrega o id da compra, não a posição na lista', () => {
    /*
      Índice quebraria a identidade a cada reordenação por filtro ou período
      (K7) — o diálogo passaria a apontar para outra compra.
    */
    expect(openDeleteDialogKey('tx-1')).toContain('tx-1')
  })

  it('undefined e null são o mesmo estado fechado', () => {
    expect(openDeleteDialogKey(undefined)).toBe(openDeleteDialogKey(null))
  })
})

describe('a política é usada onde os diálogos são irmãos', () => {
  const consumidores = [
    ['Extrato', '../app/(dashboard)/transactions/page.tsx'],
    ['painel da fatura', '../components/invoice-details-drawer.tsx'],
  ] as const

  const ler = (rel: string) =>
    readFileSync(new URL(rel, import.meta.url), 'utf-8')
  /* Sem comentários: a prosa cita `'none'` e casaria com as asserções. */
  const code = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('as duas telas derivam a key do helper', () => {
    for (const [nome, caminho] of consumidores) {
      const fonte = code(ler(caminho))
      expect(fonte, `${nome} não usa openDeleteDialogKey`).toContain(
        'openDeleteDialogKey(',
      )
      expect(fonte, `${nome} não usa scopeDialogKey`).toContain('scopeDialogKey(')
    }
  })

  it('nenhuma delas volta a montar a key à mão', () => {
    /*
      A regressão que este teste barra: alguém "simplifica" de volta para a
      sentinela literal, e o warning volta em silêncio.
    */
    for (const [nome, caminho] of consumidores) {
      const fonte = code(ler(caminho))
      expect(fonte, `${nome} voltou à sentinela literal`).not.toContain("?? 'none'")
      expect(fonte, `${nome} voltou à sentinela literal`).not.toContain(": 'none'")
    }
  })
})
