import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { resolveInstallmentCount } from './transaction-plan.helper';
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
 * Estes testes fixam a resposta ATUAL. Nenhum deles mudou o backend — eles
 * documentam a fronteira que já existe, e passam a falhar se ela cair.
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

  it('B6: NÃO existe teto no DTO — o limite de 64 é só do formulário', async () => {
    /*
      Assimetria REAL, registrada sem ser corrigida: o formulário limita a 64
      (`max={64}` e `max(64)` no schema) e a API aceita mais. Uma chamada
      direta com 200 cria 200 lançamentos.

      Fora do escopo desta fase (§21/§44 pedem preservar o máximo vigente).
      Este teste documenta o estado atual; se um `@Max` for adicionado, ele
      falha e obriga a decisão a ser consciente.
    */
    expect(await erros({ installments: 200 })).toEqual([]);
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
