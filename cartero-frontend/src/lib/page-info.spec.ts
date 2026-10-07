import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ContextHeading } from '@/components/ui/context-heading'

const dashboard = '../app/(dashboard)'

const pages: Array<{
  route: string
  title: string
  subtitle: string
  explanation: string
  action?: string
}> = [
  {
    route: 'budget',
    title: 'Orçamento',
    subtitle: 'Uma visão do que entrou, saiu e ainda está pendente no Cartero.',
    explanation: 'Veja entradas e saídas registradas, valores pendentes e o resultado após essas pendências.',
  },
  {
    route: 'commitments',
    title: 'Parcelas',
    subtitle: 'Acompanhe as parcelas que ainda vão vencer.',
    explanation: 'o reembolso não é calculado aqui.',
  },
  {
    route: 'banks',
    title: 'Bancos',
    subtitle: 'Gerencie seus bancos e cartões de crédito',
    explanation: 'histórico de faturas de cada cartão',
    action: 'Novo banco',
  },
  {
    route: 'persons',
    title: 'Pessoas',
    subtitle: 'Contatos vinculados a dívidas e cobranças',
    explanation: 'acompanhar pendências e o histórico relacionado ao mês.',
    action: 'Nova pessoa',
  },
  {
    route: 'categories',
    title: 'Categorias',
    subtitle: 'Organize seus gastos por categoria',
    explanation: 'Algumas categorias são mantidas pelo Cartero.',
    action: 'Nova categoria',
  },
]

describe('page contextual help', () => {
  it.each(pages)('$title keeps one page heading, approved copy and its action', ({ route, title, subtitle, explanation, action }) => {
    const source = readFileSync(new URL(`${dashboard}/${route}/page.tsx`, import.meta.url), 'utf8')
    expect(source).toContain('<ContextHeading')
    expect(source).toContain('level={1}')
    expect(source).toContain(`title="${title}"`)
    expect(source).toContain(`description="${subtitle}"`)
    expect(source).toContain(`infoLabel="Sobre ${title}"`)
    expect(source).toContain(explanation)
    if (action) expect(source).toContain(action)
  })

  it('renders an h1 with a named button beside it, preserving the h2 default for tabs', () => {
    const props = {
      title: 'Orçamento',
      description: 'Resumo do período.',
      infoContent: 'Entradas e saídas do período.',
      infoLabel: 'Sobre Orçamento',
    }
    const page = renderToStaticMarkup(createElement(ContextHeading, { ...props, level: 1, className: 'min-w-min flex-1' }))
    const context = renderToStaticMarkup(createElement(ContextHeading, props))

    expect(page).toMatch(/<h1[^>]*>Orçamento<\/h1>/)
    expect(page).toMatch(/<button[^>]*aria-label="Sobre Orçamento"/)
    expect(page).toContain('inline-flex max-w-full items-center')
    expect(page).toContain('min-w-min flex-1')
    expect(page.match(/<p[^>]*>/)?.[0]).not.toContain('whitespace-nowrap')
    expect(context).toMatch(/<h2[^>]*>Orçamento<\/h2>/)
  })

  it.each(['banks', 'persons', 'categories', 'budget'])('%s lets the subtitle shrink before wrapping its action', (route) => {
    const source = readFileSync(new URL(`${dashboard}/${route}/page.tsx`, import.meta.url), 'utf8')
    const header = source.slice(source.indexOf('<ContextHeading'), source.indexOf('</Button>', source.indexOf('<ContextHeading')))

    expect(header).toContain('className="min-w-min flex-1"')
    expect(header).toContain('className="shrink-0"')
    expect(header).not.toContain('w-full')
    expect(source).toContain('flex flex-wrap items-start justify-between')
  })
})
