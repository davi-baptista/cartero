import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  personPriorityRank,
  sortPeopleByPriority,
  nextItemLabel,
} from './person-next-item'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Quem precisa de atenção primeiro
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `GET /persons` faz `findMany` sem `orderBy`, então a lista chegava na ordem
 * que o Postgres devolvesse. Na prática, pessoas com "R$ 0,00 · SEM SALDO"
 * apareciam antes de quem tinha cobrança atrasada — e a tela existe para ser
 * varrida de cima para baixo.
 *
 * A régua é a mesma de Bancos: urgência, depois proximidade, depois o que não
 * pede ação.
 *
 *   0 atrasado · 1 hoje · 2 futuro · 3 tem saldo sem data · 4 sem saldo
 */

const HOJE = '2026-09-02'

const receber = (dueDate: string) => ({ direction: 'receive' as const, dueDate })
const pagar = (dueDate: string) => ({ direction: 'pay' as const, dueDate })

/** Uma pessoa como a lista a conhece: nome, saldo e o evento exibido. */
function pessoa(
  name: string,
  netBalance: number,
  nextItem: ReturnType<typeof receber> | ReturnType<typeof pagar> | null = null,
) {
  return { name, netBalance, nextItem }
}

const ordem = (
  people: ReturnType<typeof pessoa>[],
  today = HOJE,
) => sortPeopleByPriority(people, today).map((p) => p.name)

describe('P-SORT-1 a P-SORT-4: urgência e proximidade', () => {
  it('P-SORT-1: atrasado precede futuro', () => {
    const lista = [
      pessoa('Futuro', 500, receber('2026-09-20')),
      pessoa('Atrasado', 300, receber('2026-08-25')),
    ]
    expect(ordem(lista)).toEqual(['Atrasado', 'Futuro'])
  })

  it('P-SORT-2: vence hoje precede futuro', () => {
    const lista = [
      pessoa('Futuro', 500, receber('2026-09-20')),
      pessoa('Hoje', 300, pagar(HOJE)),
    ]
    expect(ordem(lista)).toEqual(['Hoje', 'Futuro'])
  })

  it('atrasado precede quem vence hoje', () => {
    /* Já passou do prazo é mais grave que ainda ter o dia inteiro. */
    const lista = [
      pessoa('Hoje', 500, receber(HOJE)),
      pessoa('Atrasado', 300, receber('2026-09-01')),
    ]
    expect(ordem(lista)).toEqual(['Atrasado', 'Hoje'])
  })

  it('P-SORT-3: amanhã precede 5 dias', () => {
    const lista = [
      pessoa('Em5d', 500, receber('2026-09-07')),
      pessoa('Amanha', 300, pagar('2026-09-03')),
    ]
    expect(ordem(lista)).toEqual(['Amanha', 'Em5d'])
  })

  it('P-SORT-4: 5 dias precede 12 dias', () => {
    const lista = [
      pessoa('Em12d', 500, receber('2026-09-14')),
      pessoa('Em5d', 300, receber('2026-09-07')),
    ]
    expect(ordem(lista)).toEqual(['Em5d', 'Em12d'])
  })

  it('entre atrasados, o vencimento mais antigo lidera', () => {
    const lista = [
      pessoa('Recente', 500, receber('2026-09-01')),
      pessoa('Antigo', 300, receber('2026-06-01')),
    ]
    expect(ordem(lista)).toEqual(['Antigo', 'Recente'])
  })
})

describe('P-SORT-5 a P-SORT-8: os grupos do fim', () => {
  it('P-SORT-5: evento relevante precede quem não tem saldo', () => {
    /* O bug relatado: "SEM SALDO" aparecia antes de cobrança atrasada. */
    const lista = [
      pessoa('AAA Sem saldo', 0, null),
      pessoa('ZZZ Atrasado', 350, receber('2026-08-28')),
    ]
    expect(ordem(lista)).toEqual(['ZZZ Atrasado', 'AAA Sem saldo'])
  })

  it('P-SORT-6: saldo zero COM obrigação real não vai para o fim', () => {
    /*
      R$ 500 de cada lado dá saldo líquido zero e duas obrigações abertas.
      Quem decide o último grupo é a ausência de EVENTO, não o valor do saldo
      — `isFullySettled` nunca foi `netBalance === 0`.
    */
    const lista = [
      pessoa('Tem saldo sem data', 800, null),
      pessoa('Zero com evento', 0, pagar('2026-09-03')),
    ]
    expect(ordem(lista)).toEqual(['Zero com evento', 'Tem saldo sem data'])
    expect(personPriorityRank(pessoa('x', 0, pagar('2026-09-03')), HOJE)).toBe(2)
  })

  it('P-SORT-7: sem saldo e sem evento fica no final', () => {
    const lista = [
      pessoa('Sem nada', 0, null),
      pessoa('Com saldo', 200, null),
      pessoa('Com evento', 300, receber('2026-09-10')),
    ]
    expect(ordem(lista)).toEqual(['Com evento', 'Com saldo', 'Sem nada'])
  })

  it('P-SORT-8: duas sem saldo usam o nome', () => {
    const lista = [
      pessoa('Carlos', 0, null),
      pessoa('Ana', 0, null),
      pessoa('Bruno', 0, null),
    ]
    expect(ordem(lista)).toEqual(['Ana', 'Bruno', 'Carlos'])
  })

  it('tem saldo sem data vem antes de sem saldo', () => {
    /*
      Grupo 3 existe porque "há algo a acertar, sem prazo conhecido" é
      diferente de "não há nada".
    */
    expect(personPriorityRank(pessoa('x', 500, null), HOJE)).toBe(3)
    expect(personPriorityRank(pessoa('y', 0, null), HOJE)).toBe(4)
  })

  it('centavos não promovem alguém do último grupo', () => {
    /* A tolerância evita que arredondamento crie um "tem saldo" fantasma. */
    expect(personPriorityRank(pessoa('x', 0.001, null), HOJE)).toBe(4)
  })
})

describe('P-SORT-9: o desempate é determinístico', () => {
  it('mesma prioridade e mesma data caem no nome', () => {
    const lista = [
      pessoa('Zeta', 500, receber('2026-09-10')),
      pessoa('Alfa', 300, receber('2026-09-10')),
    ]
    expect(ordem(lista)).toEqual(['Alfa', 'Zeta'])
  })

  it('a ordem não depende de como a lista chegou', () => {
    /*
      Duas entradas com a mesma composição, embaralhadas: se divergirem,
      alguma dimensão do comparador caiu na ordem de inserção.
    */
    const a = [
      pessoa('Ana', 100, receber('2026-09-10')),
      pessoa('Bruno', 200, receber('2026-09-10')),
      pessoa('Carlos', 0, null),
    ]
    const b = [a[2], a[1], a[0]]
    expect(ordem(a)).toEqual(ordem(b))
  })

  it('a entrada não é reordenada no lugar', () => {
    /*
      A lista vem do cache do React Query: ordenar em `sort` sobre ela faria
      dois consumidores verem ordens diferentes.
    */
    const lista = [pessoa('Zeta', 0, null), pessoa('Alfa', 500, receber('2026-09-05'))]
    const original = lista.map((p) => p.name)
    sortPeopleByPriority(lista, HOJE)
    expect(lista.map((p) => p.name)).toEqual(original)
  })
})

describe('P-SORT-10 a P-SORT-12: coerência com a row', () => {
  it('P-SORT-10: trocar o dia de referência pode reordenar', () => {
    /*
      A lista é mensal e a régua compara com hoje: um vencimento em 05/09 é
      futuro no dia 02 e atraso no dia 10.
    */
    const lista = [
      pessoa('Vence05', 300, receber('2026-09-05')),
      pessoa('Vence20', 500, receber('2026-09-20')),
    ]
    expect(ordem(lista, '2026-09-02')).toEqual(['Vence05', 'Vence20'])

    const rank = personPriorityRank(lista[0], '2026-09-10')
    expect(rank).toBe(0)
  })

  it('P-SORT-11: ordena pelo MESMO item que gera o subtexto', () => {
    /*
      Se a ordem usasse um evento invisível, a lista pareceria embaralhada:
      uma linha dizendo "Receber em 12d" passaria à frente de "Pagar amanhã".
    */
    const amanha = pessoa('Amanha', -120, pagar('2026-09-03'))
    const em12 = pessoa('Em12d', 462, receber('2026-09-14'))

    expect(ordem([em12, amanha])).toEqual(['Amanha', 'Em12d'])
    /* E a copy confirma o que a ordem afirma. */
    expect(nextItemLabel(amanha.nextItem, HOJE)).toBe('Pagar amanhã')
    expect(nextItemLabel(em12.nextItem, HOJE)).toBe('Receber em 12d')
  })

  it('P-SORT-12: a direção não influencia a prioridade', () => {
    /*
      Receber e Pagar competem pela mesma régua: o que vence antes vem antes.
      Privilegiar um dos sentidos esconderia obrigação do outro.
    */
    const receberAmanha = pessoa('Receber', 500, receber('2026-09-03'))
    const pagarDepois = pessoa('Pagar', -500, pagar('2026-09-10'))
    expect(ordem([pagarDepois, receberAmanha])).toEqual(['Receber', 'Pagar'])

    const pagarAmanha = pessoa('PagarAmanha', -500, pagar('2026-09-03'))
    const receberDepois = pessoa('ReceberDepois', 500, receber('2026-09-10'))
    expect(ordem([receberDepois, pagarAmanha])).toEqual([
      'PagarAmanha',
      'ReceberDepois',
    ])
  })

  it('o valor NÃO participa da ordem', () => {
    /* R$ 1.000 em 30 dias não é mais urgente que R$ 50 vencidos ontem. */
    const lista = [
      pessoa('Grande', 100000, receber('2026-10-02')),
      pessoa('Pequeno', 50, receber('2026-09-01')),
    ]
    expect(ordem(lista)).toEqual(['Pequeno', 'Grande'])
  })
})

describe('a página consome a policy', () => {
  const PAGE = readFileSync(
    new URL('../app/(dashboard)/persons/page.tsx', import.meta.url),
    'utf-8',
  )
  const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('ordena pela policy compartilhada, não por sort local', () => {
    /*
      A policy passou a escolher entre urgência e magnitude histórica pelo
      ciclo do mês — `personPriorityRank`, que este arquivo protege, continua
      sendo a autoridade do ramo de urgência.
    */
    expect(code).toContain('sortPersonRowsForMonth(')
    expect(code).toContain('orderedPersons')
  })

  it('a ordem usa o nextItem dos saldos', () => {
    /* O join com os saldos é onde a urgência vive. */
    expect(code).toContain('nextItem: balance.nextItem')
    expect(code).toContain('netBalance: balance.netBalance')
  })

  it('não ordena antes dos saldos chegarem', () => {
    /*
      Sem os saldos, todos cairiam no último grupo e a lista reordenaria
      quando a resposta chegasse — o mesmo piscar que Bancos já corrigiu.
    */
    expect(code).toContain('if (balancesLoading) return persons')
  })
})
