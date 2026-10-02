import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Uma linguagem de lista, quatro telas
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Extrato, Bancos, Dívidas e A Receber escreviam a MESMA anatomia — avatar,
 * título, chevron, metadata, valor, metadata secundária — cada uma por conta
 * própria. E já haviam divergido no que menos se nota de perto: Extrato
 * respirava `py-3.5` com avatar de 40px, Dívidas e A Receber usavam `py-3`
 * com avatar de 32px.
 *
 * Junto com a padronização, Dívidas e A Receber deixaram de expor
 * Editar/Excluir na row. A lista identifica; o detalhe administra.
 *
 * O risco dessa mudança não é visual — é de PERMISSÃO. Mover um botão de
 * lugar não pode transformar entidade protegida em editável, e é isso que a
 * segunda metade deste arquivo vigia.
 *
 * Sem DOM na suíte: o alvo é a composição dos arquivos, como em
 * `statement-scope.spec.ts`.
 */

const ler = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8')

const PRIMITIVE = ler('../components/ui/financial-list-row.tsx')

const EXTRATO = ler('../app/(dashboard)/movements/statement/page.tsx')
const OBLIGATIONS = ler('../app/(dashboard)/movements/obligations/obligations-client.tsx')
const PESSOAS = ler('../app/(dashboard)/persons/page.tsx')
const ASSINATURAS = ler('../app/(dashboard)/subscriptions/page.tsx')
const DRAWER_DIVIDA = ler('../app/(dashboard)/debts/debt-detail-drawer.tsx')
const DRAWER_RECEBER = ler('../app/(dashboard)/receivables/receivable-detail-drawer.tsx')
const LISTAS = { Extrato: EXTRATO, Movements: OBLIGATIONS, Pessoas: PESSOAS, Assinaturas: ASSINATURAS }
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('contratos de linguagem das superficies atuais', () => {
  it('as listas ativas compoem pelo primitive compartilhado', () => {
    expect(PRIMITIVE).toContain('export const ROW_AMOUNT_CLASS')
    expect(PRIMITIVE).toContain('export const ROW_TITLE_CLASS')
    for (const [name, source] of Object.entries(LISTAS)) {
      expect(source, name).toContain(name === 'Movements' ? '<FinancialSettlementRow' : '<FinancialListRow')
      expect(code(source), name).not.toContain('px-0 py-3.5 text-left outline-none transition-colors')
    }
  })

  it('as superficies de d?vida e receb?vel usam drawers can?nicos read-only em Movimenta??es', () => {
    expect(OBLIGATIONS).toContain('<DebtDetailDrawer')
    expect(OBLIGATIONS).toContain('<ReceivableDetailDrawer')
    expect(OBLIGATIONS).toContain('readOnly')
  })

  it('os drawers mant?m a origem e a pol?tica de exclus?o vigente', () => {
    expect(DRAWER_RECEBER).toContain('<Link')
    expect(DRAWER_RECEBER).toContain('resolveReceivableDeletePolicy(receivable)')
    expect(DRAWER_RECEBER).toContain('canDeleteReceivable(policy)')
    expect(DRAWER_DIVIDA).toContain('DetailDrawer')
  })

  it('a pessoa e o extrato permanecem superficies atuais', () => {
    expect(PESSOAS).toContain('FinancialListRow')
    expect(EXTRATO).toContain('FinancialListRow')
    expect(ASSINATURAS).toContain('FinancialListRow')
  })
})
