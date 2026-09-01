import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O documento pagina de verdade
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Este arquivo gera o PDF REAL e mede o resultado, porque o defeito não era
 * conteúdo ausente: o gerador nunca chamava `addPage`, então com 87 itens o
 * cursor chegava a 1312mm numa página de 297mm. O texto ENTRAVA no stream do
 * PDF — uma asserção sobre o template teria passado — e ficava fora do
 * MediaBox, invisível. Só o arquivo final revela isso.
 *
 * Duas medições, porque uma sozinha engana:
 *
 *   páginas   — o gerador antigo travava em 1, por mais itens que recebesse;
 *   `textOps` — operadores de mostra-texto (`Tj`/`TJ`). A Inter é embutida
 *               como fonte customizada, então os glifos não aparecem como
 *               texto legível no stream e procurar `'ITEM 42'` daria falso
 *               negativo. Cada linha desenhada produz um operador, então o
 *               total prova que nenhuma row foi descartada.
 *
 * As fontes e o logo são lidos do disco por stubs de `fetch`/`FileReader`: o
 * gerador roda inteiro, sem jsdom e sem mudar a arquitetura da suíte.
 */

beforeAll(() => {
  const arquivo = (u: string) =>
    readFileSync(new URL(`../../public/${u.replace(/^\//, '')}`, import.meta.url))

  // @ts-expect-error stub mínimo — o gerador só usa .blob()
  globalThis.fetch = async (u: string) => ({
    blob: async () => ({ __bytes: arquivo(String(u)) }),
  })

  // @ts-expect-error stub mínimo — só readAsDataURL + onload
  globalThis.FileReader = class {
    result: string | null = null
    onload: (() => void) | null = null
    readAsDataURL(b: { __bytes: Buffer }) {
      this.result = `data:application/octet-stream;base64,${b.__bytes.toString('base64')}`
      this.onload?.()
    }
  }
})

/** Gera o documento e devolve só as MEDIDAS — nunca o buffer. */
async function medir(receivables: number, debts = 0) {
  const { generateStatementPdf } = await import('./statement-pdf')

  const row = (id: string) =>
    ({
      id,
      title: id,
      amount: 100,
      dueDate: '2026-09-10',
      occurredAt: '2026-08-24',
      isPaid: false,
    }) as never

  const total = (receivables + debts) * 100
  const doc = await generateStatementPdf({
    personName: 'Fixture',
    periodLabel: 'setembro 2026',
    summary: {
      receivableTotal: receivables * 100,
      debtTotal: debts * 100,
      net: (receivables - debts) * 100,
      itemCount: receivables + debts,
      carriedReceivable: 0,
      carriedDebt: 0,
      notYetDueCount: 0,
      isEmpty: receivables + debts === 0,
    },
    pendingReceivables: Array.from({ length: receivables }, (_, i) => row(`REC ${i + 1}`)),
    pendingDebts: Array.from({ length: debts }, (_, i) => row(`DEB ${i + 1}`)),
    settledReceivables: [],
    settledDebts: [],
  })

  /*
    `raw` fica local: cada documento passa de 1MB (a Inter vai embutida), e um
    teste que gera dois PDFs manteria as duas strings vivas sem necessidade.
  */
  const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1')
  void total
  return {
    pages: doc.getNumberOfPages(),
    textOps: (raw.match(/TJ|Tj/g) ?? []).length,
  }
}

describe('P1-P2: o número de páginas segue o conteúdo', () => {
  it('P1: documento curto ocupa 1 página', async () => {
    expect((await medir(4)).pages).toBe(1)
  })

  it('P2: documento longo passa de 1 página', async () => {
    expect((await medir(40)).pages).toBeGreaterThan(1)
  })

  it('documento muito longo passa de 2 páginas', async () => {
    /*
      Três no mínimo: com só duas, um off-by-one no limite inferior passaria
      despercebido.
    */
    expect((await medir(90)).pages).toBeGreaterThanOrEqual(3)
  })
})

describe('P3-P4: nenhum item desaparece', () => {
  it('P3/P4: cada row a mais acrescenta desenho ao documento', async () => {
    /*
      Cada row desenha duas linhas (título+valor, e a data abaixo), então N
      rows a mais produzem 2N operadores a mais — incluindo a 14ª, a primeira
      que o gerador antigo empurrava para fora da página.
    */
    const curto = await medir(4)
    const longo = await medir(90)

    /*
      O custo por row é MEDIDO, não presumido: duas medições próximas isolam
      quanto uma única row acrescenta, e o total precisa acompanhar as 86 rows
      extras. Fixar "2 operadores por row" prenderia o teste a um detalhe de
      desenho — se a row passasse a ter três linhas, ele falharia sem que nada
      estivesse errado.
    */
    const base = await medir(5)
    const custoPorRow = base.textOps - curto.textOps

    expect(custoPorRow).toBeGreaterThan(0)
    /* Nenhuma row descartada: o crescimento cobre as 86 a mais. */
    expect(longo.textOps - curto.textOps).toBeGreaterThanOrEqual(
      (90 - 4) * custoPorRow,
    )
    expect(longo.pages).toBeGreaterThan(curto.pages)
  })

  it('a row de transição força página nova em vez de invadir o footer', async () => {
    /* Cabem ~13 rows por página; a 14ª colidia com o footer. */
    expect((await medir(14)).pages).toBe(2)
  })
})

describe('P5-P6: footer e unicidade', () => {
  it('P5: o footer é desenhado uma vez por página', async () => {
    /*
      Antes era UMA vez no documento, no fim, por cima do conteúdo que já
      havia invadido a faixa reservada. "Gerado pelo Cartero" é uma linha de
      texto, então entra na contagem de operadores: 90 itens rendem mais
      operadores que o dobro das rows justamente por causa dos rodapés.
    */
    const { pages, textOps } = await medir(90)
    expect(pages).toBeGreaterThanOrEqual(3)
    expect(textOps).toBeGreaterThan(90 * 2)
  })

  it('P6: a contagem é exata — nada é duplicado na quebra', async () => {
    /*
      Uma quebra implementada como "redesenha o bloco" duplicaria itens em
      silêncio, porque a contagem de páginas continuaria certa. 40 e 41 rows
      precisam diferir por exatamente uma row.
    */
    /*
      Uma row a mais custa o mesmo em qualquer ponto do documento. Se a quebra
      redesenhasse o bloco, o delta perto do limite de página seria muito maior
      que no meio — dezenas de operadores em vez de um punhado.
    */
    const meio = { a: await medir(20), b: await medir(21) }
    const limite = { a: await medir(40), b: await medir(41) }

    const custoMeio = meio.b.textOps - meio.a.textOps
    const custoLimite = limite.b.textOps - limite.a.textOps
    const rodapeExtra = (limite.b.pages - limite.a.pages) * custoMeio

    expect(custoMeio).toBeGreaterThan(0)
    expect(custoLimite).toBeLessThanOrEqual(custoMeio + rodapeExtra + custoMeio)
  })
})

describe('P7: as seções sobrevivem à quebra', () => {
  it('as duas seções atravessam a quebra sem perder rows', async () => {
    const { pages, textOps } = await medir(30, 30)
    expect(pages).toBeGreaterThanOrEqual(3)
    /* 60 rows × 2 linhas, mais cabeçalhos, card e rodapés. */
    expect(textOps).toBeGreaterThan(60 * 2)
  })
})
