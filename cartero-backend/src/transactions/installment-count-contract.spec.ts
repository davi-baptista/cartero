import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { PreviewTransactionDto } from './dto/preview-transaction.dto';
import { CreateDebtDto } from 'src/debts/dto/create-debt.dto';
import { CreateReceivableDto } from 'src/receivables/dto/create-receivable.dto';
import { resolveInstallmentCount } from './transaction-plan.helper';
import { MAX_INSTALLMENTS } from 'src/common/constants/installments';
import { TransactionType } from '@prisma/client';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * O que a API aceita como quantidade de parcelas
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O formulário passou a permitir rascunho vazio no campo de parcelas, o que
 * torna a pergunta inevitável: alguém que contorne a tela e chame a API
 * direto consegue persistir um parcelamento degenerado?
 *
 * A maior parte destes testes documenta a fronteira que já existia (zero,
 * negativo, fracionário). O TETO é novo: o formulário limitava a 64 e a API
 * não limitava nada, então uma chamada direta com 200 criava 200 lançamentos.
 *
 * ── A representação de compra à vista ──
 *
 * `resolveInstallmentCount` normaliza `undefined` e `1` para o MESMO valor: 1
 * lançamento. As duas formas são compra à vista, e isso é intencional —
 * `Math.max(1, ...)` existe justamente para garantir o piso.
 *
 * Por isso NÃO existe, no payload, um "modo Parcelado com 1 parcela" para o
 * backend recusar: o modo não viaja na requisição. `installments: 1` é
 * indistinguível de uma compra à vista legítima, e recusá-lo quebraria o
 * caminho canônico.
 *
 * Quem garante "parcelado ⇒ >= 2" é o formulário, onde o modo existe. O
 * backend garante o que dá para garantir sem inventar um modo: nada de zero,
 * nada de fracionário, nada de negativo.
 */

async function erros(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateTransactionDto, {
    bankId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    categoryId: '3f2504e0-4f89-11d3-9a0c-0305e82c3302',
    type: TransactionType.CREDIT_CARD,
    title: 'Compra',
    amount: 100,
    date: '2026-09-05',
    ...payload,
  });

  const resultado = await validate(dto as object);
  return resultado.flatMap((e) => Object.keys(e.constraints ?? {}));
}

// ─── B1-B6: a fronteira do DTO ──────────────────────────────────────────────

describe('B1-B6: o que o DTO aceita', () => {
  it('B1: `installments: 0` é REJEITADO', async () => {
    /* `@Min(1)` — zero parcelas não descreve compra nenhuma. */
    expect(await erros({ installments: 0 })).toContain('min');
  });

  it('B2: `installments: 1` é ACEITO — é compra à vista', async () => {
    /*
      Deliberadamente aceito. O payload não carrega o modo, então `1` aqui é
      indistinguível de uma compra à vista, que é representação canônica.
      Recusá-lo quebraria o caminho normal.
    */
    expect(await erros({ installments: 1 })).toEqual([]);
  });

  it('B3: ausente é ACEITO — a outra forma de dizer à vista', async () => {
    expect(await erros({})).toEqual([]);
  });

  it('B4: `installments: 2` é ACEITO', async () => {
    expect(await erros({ installments: 2 })).toEqual([]);
  });

  it('negativo é REJEITADO', async () => {
    expect(await erros({ installments: -1 })).toContain('min');
  });

  it('fracionário é REJEITADO', async () => {
    expect(await erros({ installments: 1.5 })).toContain('isInt');
  });

  it('texto é REJEITADO', async () => {
    expect(await erros({ installments: 'dez' })).toContain('isInt');
  });

  it('B4: o MÁXIMO é aceito', async () => {
    expect(await erros({ installments: MAX_INSTALLMENTS })).toEqual([]);
  });

  it('B5: MÁXIMO + 1 é REJEITADO', async () => {
    /*
      O teto que faltava. O formulário limitava a 64 e a API não limitava
      nada — uma chamada direta com 200 criava 200 lançamentos, e 200
      faturas no caso do cartão.
    */
    expect(await erros({ installments: MAX_INSTALLMENTS + 1 })).toContain('max');
  });

  it('B6: 200 é REJEITADO', async () => {
    expect(await erros({ installments: 200 })).toContain('max');
  });

  it('o teto vem da constante compartilhada, não de um literal solto', async () => {
    /*
      São QUATRO DTOs com a mesma regra (transação, prévia, dívida,
      recebível). Repetir `64` em cada um deixaria a próxima mudança pela
      metade — que é como o teto nasceu ausente aqui.
    */
    expect(MAX_INSTALLMENTS).toBe(64);
  });
});

// ─── A normalização do domínio ──────────────────────────────────────────────

describe('resolveInstallmentCount: ausente e 1 são a mesma coisa', () => {
  const base = { type: TransactionType.CREDIT_CARD, isRefund: false };

  it('undefined → 1 lançamento', () => {
    expect(resolveInstallmentCount({ ...base })).toBe(1);
  });

  it('1 → 1 lançamento', () => {
    expect(resolveInstallmentCount({ ...base, installments: 1 })).toBe(1);
  });

  it('0 → piso de 1, se escapar do DTO', () => {
    /*
      Defesa em profundidade: o `Math.max(1, ...)` impede um laço de zero
      iterações mesmo que a validação seja contornada. Nunca gera um
      parcelamento vazio — o pior caso é uma compra à vista.
    */
    expect(resolveInstallmentCount({ ...base, installments: 0 })).toBe(1);
  });

  it('2+ preserva a quantidade', () => {
    expect(resolveInstallmentCount({ ...base, installments: 10 })).toBe(10);
  });

  it('só CRÉDITO parcela — PIX ignora a quantidade', () => {
    expect(
      resolveInstallmentCount({
        type: TransactionType.PIX,
        installments: 10,
      }),
    ).toBe(1);
  });

  it('estorno nunca parcela', () => {
    expect(
      resolveInstallmentCount({ ...base, isRefund: true, installments: 10 }),
    ).toBe(1);
  });
});

// ─── O mesmo teto nos outros DTOs que parcelam ──────────────────────────────

describe('o teto vale em TODOS os caminhos de parcelamento', () => {
  /*
    Não é só a criação de transação: prévia, dívida e recebível têm o mesmo
    campo e tinham a mesma ausência de teto. Corrigir um só deixaria três
    portas abertas para o mesmo problema.
  */
  const casos: Array<[string, new () => object, Record<string, unknown>]> = [
    [
      'PreviewTransactionDto',
      PreviewTransactionDto,
      {
        bankId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        type: TransactionType.CREDIT_CARD,
        title: 'Compra',
        amount: 100,
        date: '2026-09-05',
      },
    ],
    [
      'CreateDebtDto',
      CreateDebtDto,
      {
        creditorName: 'Alguém',
        title: 'Dívida',
        amount: 100,
        dueDate: '2026-09-10',
        occurredAt: '2026-09-01',
      },
    ],
    [
      'CreateReceivableDto',
      CreateReceivableDto,
      {
        debtorName: 'Alguém',
        title: 'Cobrança',
        amount: 100,
        dueDate: '2026-09-10',
        occurredAt: '2026-09-01',
      },
    ],
  ];

  for (const [nome, Dto, base] of casos) {
    it(`${nome}: aceita o máximo e recusa acima dele`, async () => {
      const chaves = async (installments: number) => {
        const dto = plainToInstance(Dto, { ...base, installments });
        const r = await validate(dto as object);
        return r.flatMap((e) => Object.keys(e.constraints ?? {}));
      };

      expect(await chaves(MAX_INSTALLMENTS)).toEqual([]);
      expect(await chaves(MAX_INSTALLMENTS + 1)).toContain('max');
      expect(await chaves(200)).toContain('max');
    });
  }
});
