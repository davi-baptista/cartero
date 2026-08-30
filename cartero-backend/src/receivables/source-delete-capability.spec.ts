import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InvoiceStatus } from '@prisma/client';
import { resolveSourceDeleteBlockReason } from 'src/common/helpers/receivable-source-capability';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Por que a compra de origem não pode ser excluída
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A cobrança automática é excluída pela COMPRA, e a compra tem as próprias
 * travas. A mais dura é pertencer a uma fatura já paga: apagá-la alteraria o
 * total de algo quitado, e o delete de Transaction recusa com
 * `ForbiddenException`.
 *
 * Sem este campo o frontend oferecia "Excluir compra e cobrança", o usuário
 * confirmava, e só então recebia a recusa. A operação estava certa; a
 * expectativa é que estava errada.
 *
 * Isto NÃO substitui a guarda: se a fatura for paga entre a leitura e a
 * confirmação, o backend recusa igual. O campo evita oferecer o que será
 * negado.
 */

const automatic = (status?: InvoiceStatus) => ({
  transactionId: 'tx-1',
  transaction: { invoice: status ? { status } : null },
});

describe('item 15: o contrato de leitura', () => {
  it('A. origem em fatura PAGA → PAID_INVOICE', () => {
    expect(resolveSourceDeleteBlockReason(automatic(InvoiceStatus.PAID))).toBe(
      'PAID_INVOICE',
    );
  });

  it('B. origem em fatura ABERTA → null', () => {
    /* Fatura aberta não trava nada: a compra continua excluível. */
    expect(
      resolveSourceDeleteBlockReason(automatic(InvoiceStatus.OPEN)),
    ).toBeNull();
  });

  it('B. fechada e em atraso também liberam', () => {
    /*
      A regra canônica do delete é `status: 'PAID'`, e só. Tratar CLOSED ou
      OVERDUE como trava seria uma SEGUNDA interpretação de "fatura imutável",
      divergindo do guard que ela deveria antecipar.
    */
    for (const status of [InvoiceStatus.CLOSED, InvoiceStatus.OVERDUE]) {
      expect(resolveSourceDeleteBlockReason(automatic(status))).toBeNull();
    }
  });

  it('D. cobrança MANUAL não inventa motivo', () => {
    /*
      Sem `transactionId` a pergunta não se aplica: não há compra de origem
      para travar. Manual é excluída diretamente.
    */
    expect(resolveSourceDeleteBlockReason({ transactionId: null })).toBeNull();
  });

  it('compra sem fatura (débito, PIX, boleto) → null', () => {
    /*
      `undefined` aqui é ausência de fatura, não fatura desconhecida: a
      relação foi pedida no `select`.
    */
    expect(resolveSourceDeleteBlockReason(automatic())).toBeNull();
  });
});

describe('a regra é a MESMA do guard de delete', () => {
  it('só PAID trava', () => {
    /*
      O guard em `TransactionsService.remove` busca
      `{ status: 'PAID' }` e lança `ForbiddenException`. Se este helper
      divergisse, a UI esconderia o botão em casos que o backend aceita — ou
      pior, ofereceria onde ele recusa.
    */
    const travados = Object.values(InvoiceStatus).filter(
      (status) => resolveSourceDeleteBlockReason(automatic(status)) !== null,
    );

    expect(travados).toEqual([InvoiceStatus.PAID]);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Item 4 — a capability sai da consulta que já existia
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A relação `Receivable → transaction → invoice` já existe no schema, então a
 * fatura entra por `select` aninhado. Cem cobranças continuam sendo UMA
 * consulta — buscar a transação por linha seria N+1 numa lista.
 */
describe('item 4: nenhuma consulta por item', () => {
  /*
    Caminhos a partir da raiz do projeto, como em `mass-assignment.spec.ts`:
    este backend compila para CommonJS, onde `import.meta` não existe.
  */
  const ler = (path: string) => readFileSync(path, 'utf8');

  const RECEIVABLES = ler('src/receivables/receivables.service.ts');
  const PERSONS = ler('src/persons/persons.service.ts');

  it('`GET /receivables` resolve por include, não por loop', () => {
    expect(RECEIVABLES).toContain('transaction: SOURCE_INVOICE_SELECT');
    /* Nada de buscar a transação dentro do map. */
    expect(RECEIVABLES).not.toContain(
      'await this.prisma.transaction.findUnique',
    );
  });

  it('o statement estende o select que JÁ existia', () => {
    /*
      A relação da transação já era carregada para decidir a competência do
      recebível automático. O `status` da fatura entrou nela — não numa
      consulta nova.
    */
    expect(PERSONS).toContain('invoice: { select: { status: true } }');
  });

  it('só o `status` atravessa — nunca a fatura ou a transação inteiras', () => {
    /*
      Item 2: devolver o modelo inteiro para responder um enum exporia dados
      que a tela não usa.
    */
    const helper = ler('src/common/helpers/receivable-source-capability.ts');
    expect(helper).toContain('invoice: { select: { status: true } }');
    expect(helper).not.toContain('include: { invoice: true }');
  });
});
