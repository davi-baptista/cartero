import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decideAnchor } from './use-detail-task-anchor'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8')
const STATEMENT = read('../app/(dashboard)/movements/statement/page.tsx')
const SUBSCRIPTIONS = read('../app/(dashboard)/subscriptions/page.tsx')
const OBLIGATIONS = read('../app/(dashboard)/movements/obligations/obligations-client.tsx')

describe('handoff atual de tarefas ligadas a detalhe', () => {
  it('Extrato e Assinaturas usam a authority compartilhada', () => {
    expect(STATEMENT).toContain('useDetailTaskAnchor')
    expect(SUBSCRIPTIONS).toContain('useDetailTaskAnchor')
    expect(STATEMENT).toContain('taskAnchor.beginFromDetail()')
    expect(STATEMENT).not.toContain('beginStandaloneTask')
    expect(SUBSCRIPTIONS).toContain('taskAnchor.beginFromDetail()')
    expect(SUBSCRIPTIONS).toContain('taskAnchor.beginStandalone()')
  })

  it('Movimenta??es abre drawers de d?vida/receb?vel em modo de leitura', () => {
    expect(OBLIGATIONS).toContain('<DebtDetailDrawer')
    expect(OBLIGATIONS).toContain('<ReceivableDetailDrawer')
    expect(OBLIGATIONS).toContain('readOnly')
  })

  it('a tarefa perde contexto ao sair do detalhe e cria??o continua standalone', () => {
    expect(decideAnchor({ anchor: 'D1', detailId: null, taskOpen: true })).toEqual({ action: 'orphan', anchor: null })
    expect(decideAnchor({ anchor: null, detailId: null, taskOpen: true })).toEqual({ action: 'keep', anchor: null })
    expect(decideAnchor({ anchor: 'D1', detailId: 'D1', taskOpen: false })).toEqual({ action: 'clear', anchor: null })
  })
})
