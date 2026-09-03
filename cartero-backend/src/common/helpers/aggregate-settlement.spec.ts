import { describe, expect, it } from 'vitest';
import { aggregateSettledAt } from './aggregate-settlement.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * A data que a row afirma é a da liquidação INTEGRAL
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Uma row de Pessoa representa vários itens. Quando todos estão resolvidos, a
 * linha da esquerda responde "quando isso acabou?" — e a única data que
 * responde isso é a MAIOR: o instante em que o último pendente foi quitado.
 */

const item = (isPaid: boolean, paidAt: string | null) => ({
  isPaid,
  paidAt: paidAt ? new Date(`${paidAt}T12:00:00.000Z`) : null,
});

const pago = (paidAt: string) => item(true, paidAt);
const aberto = () => item(false, null);

describe('a MAIOR data, porque é quando o agregado terminou', () => {
  it('um item devolve a própria data', () => {
    expect(aggregateSettledAt([pago('2026-08-18')])).toBe('2026-08-18');
  });

  it('duas datas devolvem a última', () => {
    expect(
      aggregateSettledAt([pago('2026-08-05'), pago('2026-08-18')]),
    ).toBe('2026-08-18');
  });

  it('três datas: nem a primeira, nem a do meio', () => {
    /*
      A menor diria quando o acerto COMEÇOU a ser resolvido — outro fato. A do
      meio não significa nada.
    */
    expect(
      aggregateSettledAt([
        pago('2026-08-04'),
        pago('2026-08-18'),
        pago('2026-08-11'),
      ]),
    ).toBe('2026-08-18');
  });

  it('a ordem de chegada não altera o resultado', () => {
    /*
      Propriedade do máximo. Um `settledAt` que guardasse "a última vista"
      passaria nos casos acima e falharia aqui.
    */
    const datas = ['2026-08-18', '2026-08-04', '2026-08-11'];

    for (const ordem of [datas, [...datas].reverse()]) {
      expect(aggregateSettledAt(ordem.map(pago))).toBe('2026-08-18');
    }
  });

  it('datas iguais devolvem a data', () => {
    expect(
      aggregateSettledAt([pago('2026-08-18'), pago('2026-08-18')]),
    ).toBe('2026-08-18');
  });
});

describe('não existe data quando a relação não terminou', () => {
  it('um item aberto zera a resposta', () => {
    /*
      O caso mais importante: com uma dívida aberta, a data do que já foi pago
      não é a conclusão de nada. Exibi-la sugeriria um acerto encerrado que
      continua devendo.
    */
    expect(aggregateSettledAt([pago('2026-08-18'), aberto()])).toBeNull();
  });

  it('a posição do item aberto não importa', () => {
    expect(aggregateSettledAt([aberto(), pago('2026-08-18')])).toBeNull();
    expect(
      aggregateSettledAt([pago('2026-08-04'), aberto(), pago('2026-08-18')]),
    ).toBeNull();
  });

  it('só itens abertos', () => {
    expect(aggregateSettledAt([aberto(), aberto()])).toBeNull();
  });

  it('nada resolvido: lista vazia', () => {
    expect(aggregateSettledAt([])).toBeNull();
  });
});

describe('nenhuma data é inventada', () => {
  it('resolvido sem `paidAt` invalida o conjunto', () => {
    /*
      A data de outro item não pode falar pela conclusão que este registro não
      conhece. Devolver 18/08 aqui afirmaria um fato que o legado não tem.
    */
    expect(
      aggregateSettledAt([pago('2026-08-18'), item(true, null)]),
    ).toBeNull();
  });

  it('um único resolvido sem data', () => {
    expect(aggregateSettledAt([item(true, null)])).toBeNull();
  });

  it('a ausência contamina o agregado inteiro, não só o item', () => {
    /*
      Não é "ignore o sem-data e use o resto": se um item não sabe quando foi
      resolvido, o agregado não sabe quando terminou.
    */
    expect(
      aggregateSettledAt([
        pago('2026-08-04'),
        pago('2026-08-11'),
        item(true, null),
      ]),
    ).toBeNull();
  });
});

describe('dia civil de Fortaleza', () => {
  it('liquidação antes das 03h UTC pertence ao dia anterior', () => {
    /*
      19/08 01h UTC é 18/08 22h em Fortaleza. Um `toISOString()` cru diria 19 —
      a row afirmaria que o acerto terminou um dia depois do que terminou.
    */
    expect(
      aggregateSettledAt([{ isPaid: true, paidAt: new Date(Date.UTC(2026, 7, 19, 1)) }]),
    ).toBe('2026-08-18');
  });

  it('meio-dia UTC é o mesmo dia civil', () => {
    expect(
      aggregateSettledAt([{ isPaid: true, paidAt: new Date(Date.UTC(2026, 7, 18, 12)) }]),
    ).toBe('2026-08-18');
  });

  it('a comparação de máximo é por instante, não por string', () => {
    /*
      Duas liquidações no mesmo dia civil, horas diferentes: o máximo continua
      correto e o dia devolvido é único.
    */
    expect(
      aggregateSettledAt([
        { isPaid: true, paidAt: new Date(Date.UTC(2026, 7, 18, 15)) },
        { isPaid: true, paidAt: new Date(Date.UTC(2026, 7, 18, 20)) },
      ]),
    ).toBe('2026-08-18');
  });
});
