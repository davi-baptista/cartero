import { describe, expect, it } from 'vitest'
import {
  comparePastRows,
  historicalMagnitude,
  sortPersonRowsForMonth,
  type OrderablePerson,
} from './person-month-order'

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A ordem tem de explicar a tela
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O mês corrente pergunta "quem precisa da minha atenção?". Um mês encerrado
 * não tem resposta para isso — nada mais vai vencer ali — e a lista caía em
 * ordem alfabética, que não responde nada.
 *
 * O passado pergunta "quem movimentou mais dinheiro?".
 */

function p(
  name: string,
  o: Partial<OrderablePerson> = {},
): OrderablePerson {
  return {
    name,
    netBalance: 0,
    periodReceivableTotal: 0,
    periodDebtTotal: 0,
    settledReceivablesCount: 0,
    settledDebtsCount: 0,
    nextItem: null,
    ...o,
  }
}

/** Uma relação histórica de valor `v` — positivo recebe, negativo paga. */
function hist(name: string, v: number, resolvido = true): OrderablePerson {
  const base = v > 0
    ? { periodReceivableTotal: v, settledReceivablesCount: resolvido ? 1 : 0 }
    : { periodDebtTotal: -v, settledDebtsCount: resolvido ? 1 : 0 }

  return p(name, { ...base, netBalance: resolvido ? 0 : v })
}

const ordem = (rows: OrderablePerson[], cycle: 'past' | 'current' | 'future') =>
  sortPersonRowsForMonth(rows, cycle, '2026-09-03').map((r) => r.name)

describe('O1-O4: mês passado ordena por magnitude histórica', () => {
  it('O1: maior valor primeiro', () => {
    expect(ordem([hist('Célia', 300), hist('Ana', 700)], 'past')).toEqual([
      'Ana',
      'Célia',
    ])
  })

  it('O2/O3: magnitude, não valor assinado', () => {
    /*
      O caso que motivou `abs`. Assinado daria Ana, Célia, Bruno — os R$ 500
      pagos ao Bruno afundariam por serem negativos, quando foram a segunda
      relação mais relevante do mês.
    */
    const rows = [hist('Célia', 300), hist('Bruno', -500), hist('Ana', 700)]

    expect(ordem(rows, 'past')).toEqual(['Ana', 'Bruno', 'Célia'])
  })

  it('O1b: a ordem NÃO é alfabética', () => {
    /*
      O bug que esta fase corrige: sem evento futuro, `personPriorityRank`
      empatava todo mundo e o desempate caía no nome, então um mês resolvido
      saía em ordem alfabética. Este caso falha se o desempate voltar a ser o
      critério principal.
    */
    const rows = [hist('Ana', 10), hist('Bruno', 500), hist('Célia', 90)]

    expect(ordem(rows, 'past')).toEqual(['Bruno', 'Célia', 'Ana'])
  })

  it('O4: mesma magnitude desempata por nome', () => {
    /*
      Sem desempate estável a ordem viria da resposta da API, e a lista mudaria
      de posição entre recarregamentos sem nenhum fato novo.
    */
    expect(
      ordem([hist('Zilda', 400), hist('Ana', -400), hist('Marta', 400)], 'past'),
    ).toEqual(['Ana', 'Marta', 'Zilda'])
  })

  it('a magnitude é do LÍQUIDO, não do bruto', () => {
    /*
      R$ 1.000 a receber e R$ 900 a pagar dão bruto 1.900 e líquido 100. A row
      exibe 100, e a ordem tem de explicar o que está na tela — ordenar por
      1.900 colocaria essa pessoa no topo com o menor número visível.
    */
    const misto = p('Misto', {
      periodReceivableTotal: 1000,
      periodDebtTotal: 900,
      settledReceivablesCount: 1,
      settledDebtsCount: 1,
    })

    expect(historicalMagnitude(misto)).toBe(100)
    expect(ordem([misto, hist('Grande', 500)], 'past')).toEqual([
      'Grande',
      'Misto',
    ])
  })
})

describe('O5-O6: atividade sempre precede ausência de atividade', () => {
  it('O5: líquido zero COM movimento precede quem não teve nada', () => {
    /*
      R$ 200 de cada lado, tudo quitado, dá magnitude ZERO. Sem o nível de
      atividade essa pessoa cairia junto de quem nunca teve nada — e a fase
      anterior gastou um contrato inteiro para distinguir os dois fatos.
    */
    const zeroComMovimento = p('Zerada', {
      periodReceivableTotal: 200,
      periodDebtTotal: 200,
      settledReceivablesCount: 1,
      settledDebtsCount: 1,
    })

    expect(ordem([p('Alheia'), zeroComMovimento], 'past')).toEqual([
      'Zerada',
      'Alheia',
    ])
  })

  it('O6: sem atividade fica no final, mesmo com nome anterior', () => {
    const rows = [p('Aaa'), hist('Zzz', 10)]

    expect(ordem(rows, 'past')).toEqual(['Zzz', 'Aaa'])
  })

  it('O5b: net-zero com movimento não é confundido com vazio em lista maior', () => {
    /*
      Um segundo guardião do nível de atividade, com mais de dois elementos: a
      probe que remove o nível passa a matar este também.
    */
    const zerada = p('Zerada', {
      periodReceivableTotal: 200,
      periodDebtTotal: 200,
      settledReceivablesCount: 1,
      settledDebtsCount: 1,
    })

    expect(
      ordem([p('Alfa'), zerada, p('Beta'), hist('Grande', 900)], 'past'),
    ).toEqual(['Grande', 'Zerada', 'Alfa', 'Beta'])
  })

  it('entre pessoas sem atividade, a ordem é o nome', () => {
    expect(ordem([p('Carlos'), p('Ana'), p('Bruno')], 'past')).toEqual([
      'Ana',
      'Bruno',
      'Carlos',
    ])
  })
})

describe('O7: a ordem do passado ignora status de quitação', () => {
  it('R$ 700 recebido continua acima de R$ 300 recebido', () => {
    expect(
      ordem([hist('Menor', 300, true), hist('Maior', 700, true)], 'past'),
    ).toEqual(['Maior', 'Menor'])
  })

  it('resolvido de valor maior precede aberto de valor menor', () => {
    /*
      No passado o que ordena é o TAMANHO da relação. O status está escrito no
      trailing de cada row, e não precisa da posição para ser comunicado.
    */
    const abertoMenor = p('Aberto', {
      periodReceivableTotal: 300,
      netBalance: 300,
      nextItem: { dueDate: '2026-08-10', direction: 'receive' },
    })

    expect(ordem([abertoMenor, hist('Resolvido', 700)], 'past')).toEqual([
      'Resolvido',
      'Aberto',
    ])
  })
})

describe('O8-O11: mês corrente continua ordenado por urgência', () => {
  const atrasado = p('Atrasado', {
    netBalance: 100,
    periodReceivableTotal: 100,
    nextItem: { dueDate: '2026-08-28', direction: 'receive' },
  })
  const venceHoje = p('Hoje', {
    netBalance: 50,
    periodReceivableTotal: 50,
    nextItem: { dueDate: '2026-09-03', direction: 'receive' },
  })
  const futuro = p('Futuro', {
    netBalance: 80,
    periodReceivableTotal: 80,
    nextItem: { dueDate: '2026-09-20', direction: 'receive' },
  })
  const resolvidoGrande = hist('Grande', 9000)

  it('O8: atrasado precede um histórico resolvido muito maior', () => {
    /*
      A regressão que a mudança do passado poderia causar. No mês corrente a
      pergunta é atenção, não tamanho: R$ 9.000 já recebidos não exigem nada.
    */
    expect(ordem([resolvidoGrande, atrasado], 'current')).toEqual([
      'Atrasado',
      'Grande',
    ])
  })

  it('O9: vencimento próximo precede resolvido', () => {
    expect(ordem([resolvidoGrande, venceHoje], 'current')).toEqual([
      'Hoje',
      'Grande',
    ])
  })

  it('O11: não é ordem por valor decrescente', () => {
    /* Se fosse, o de R$ 9.000 lideraria e o atrasado de R$ 100 seria o último. */
    const r = ordem([atrasado, resolvidoGrande, venceHoje, futuro], 'current')

    expect(r).toEqual(['Atrasado', 'Hoje', 'Futuro', 'Grande'])
    expect(r[0]).not.toBe('Grande')
  })

  it('O10: sem atividade fica no final também no corrente', () => {
    expect(ordem([p('Vazia'), venceHoje], 'current')).toEqual([
      'Hoje',
      'Vazia',
    ])
  })
})

describe('O12-O13: mês futuro é operacional', () => {
  it('O12: o vencimento mais próximo lidera', () => {
    const perto = p('Perto', {
      netBalance: 10,
      periodReceivableTotal: 10,
      nextItem: { dueDate: '2026-10-05', direction: 'receive' },
    })
    const longe = p('Longe', {
      netBalance: 900,
      periodReceivableTotal: 900,
      nextItem: { dueDate: '2026-10-28', direction: 'receive' },
    })

    expect(ordem([longe, perto], 'future')).toEqual(['Perto', 'Longe'])
  })

  it('O13: futuro não usa magnitude histórica', () => {
    /*
      O contraste com o passado é intencional: o futuro é operacional, e o
      valor grande de outubro não é mais urgente por ser grande.
    */
    const grandeLonge = p('GrandeLonge', {
      netBalance: 5000,
      periodReceivableTotal: 5000,
      nextItem: { dueDate: '2026-10-30', direction: 'receive' },
    })
    const pequenoPerto = p('PequenoPerto', {
      netBalance: 5,
      periodReceivableTotal: 5,
      nextItem: { dueDate: '2026-10-02', direction: 'receive' },
    })

    expect(ordem([grandeLonge, pequenoPerto], 'future')).toEqual([
      'PequenoPerto',
      'GrandeLonge',
    ])
  })
})

describe('propriedades da ordenação', () => {
  it('não muta a entrada', () => {
    /*
      A lista vem do cache do React Query; ordenar no lugar faria dois
      consumidores verem ordens diferentes.
    */
    const rows = [hist('Zzz', 10), hist('Aaa', 900)]
    const antes = rows.map((r) => r.name)

    sortPersonRowsForMonth(rows, 'past')

    expect(rows.map((r) => r.name)).toEqual(antes)
  })

  it('o comparador do passado é antissimétrico', () => {
    /*
      Sem isso o resultado dependeria da ordem de entrada, e a lista se
      reembaralharia entre renders.
    */
    const a = hist('Ana', 700)
    const b = hist('Bruno', -500)

    expect(Math.sign(comparePastRows(a, b))).toBe(-Math.sign(comparePastRows(b, a)))
  })

  it('centavos de resíduo não decidem posição', () => {
    /*
      0.1 + 0.2 - 0.3 deixa ~5.5e-17. Sem tolerância, duas magnitudes iguais
      poderiam alternar de posição a cada render.
    */
    const residuo = 0.1 + 0.2 - 0.3
    const zilda = p('Zilda', { periodReceivableTotal: 100 + residuo })
    const ana = p('Ana', { periodReceivableTotal: 100 })

    /*
      Tratadas como empate, então decide o nome — e não a fração de centavo,
      que colocaria Zilda na frente.
    */
    expect(comparePastRows(zilda, ana)).toBeGreaterThan(0)
    expect(comparePastRows(ana, zilda)).toBeLessThan(0)
  })

  it('lista vazia e de um item não quebram', () => {
    expect(ordem([], 'past')).toEqual([])
    expect(ordem([hist('Só', 1)], 'past')).toEqual(['Só'])
  })
})
