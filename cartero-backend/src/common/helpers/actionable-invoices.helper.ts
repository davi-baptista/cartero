import { Prisma, InvoiceStatus } from '@prisma/client';
import { civilDay } from './date-only.helper';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * "O que exige atenção agora?" — a política ACTIONABLE, agora no backend
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O Web já respondia esta pergunta em `bank-invoice-selection.ts`
 * (`selectBankInvoice`/`orderBanksByUrgency`), mas só no cliente — e é uma
 * regra de PRODUTO, não apresentação: decide quais faturas entram na tela e
 * em que ordem, não apenas como colori-las.
 *
 * Esta é a mesma semântica, na mesma ordem de decisão, movida para uma
 * authority única que qualquer consumidor (Web, mobile) pode compartilhar sem
 * reimplementar. O Web continua com sua cópia por ora — migrá-lo é um
 * follow-up separado (ver M5A §23/§45) — mas nenhum código daqui foi
 * importado dele; a semântica foi auditada e reproduzida deliberadamente.
 *
 * ── O que é "actionable" ──
 *
 * INCLUI:  OVERDUE, CLOSED, OPEN.
 * EXCLUI:  PAID (resolvida — não exige nada) e `totalAmount <= 0` (não há o
 *          que cobrar).
 *
 * A exclusão por zero usa o BRUTO (`totalAmount`), não `ownAmount` — é a
 * mesma régua do Web, e não é trocada aqui só porque `ownAmount` pareceria
 * mais "correto": mudar essa condição é decisão de produto fora de escopo
 * desta fase.
 *
 * ── Prioridade e desempate ──
 *
 * OVERDUE → CLOSED → OPEN. Dentro do mesmo status, a `actionDate` mais
 * próxima vence; empate final por nome do banco (`localeCompare`, a mesma
 * comparação que o Web já usa — sem normalização adicional).
 */

/** O que a authority precisa de cada fatura candidata. */
export interface ActionableInvoiceCandidate {
  bankName: string;
  status: InvoiceStatus;
  /** Bruto — usado SOMENTE para o filtro de zero, nunca exposto. */
  totalAmount: Prisma.Decimal | number;
  closeDate: Date;
  dueDate: Date;
  /** Parte que pertence a outras pessoas — mesma authority de `GET /invoices`. */
  reimbursable: Prisma.Decimal | number;
}

export interface ActionableInvoiceItem {
  bankName: string;
  status: InvoiceStatus;
  /** Dia civil `YYYY-MM-DD` — nunca timestamp. */
  closeDate: string;
  dueDate: string;
  actionDate: string;
  /** `totalAmount − reimbursable`, em centavos inteiros. Nunca o bruto. */
  ownAmountCents: number;
}

/** Menor prioridade primeiro. `PAID` nunca aparece aqui — não tem entrada. */
const STATUS_PRIORITY: Partial<Record<InvoiceStatus, number>> = {
  [InvoiceStatus.OVERDUE]: 0,
  [InvoiceStatus.CLOSED]: 1,
  [InvoiceStatus.OPEN]: 2,
};

/**
 * A data que importa para cada status.
 *
 * OPEN ainda não tem vencimento relevante — o que se aproxima é o
 * fechamento. CLOSED e OVERDUE já têm o valor fechado; o que resta é o
 * vencimento.
 */
function actionDateOf(candidate: ActionableInvoiceCandidate): Date {
  return candidate.status === InvoiceStatus.OPEN
    ? candidate.closeDate
    : candidate.dueDate;
}

/**
 * Reais → centavos inteiros, sem passar por ponto flutuante binário.
 *
 * `Prisma.Decimal` representa o valor exatamente; `.mul(100)` continua exato
 * porque desloca a vírgula, não multiplica em IEEE-754. Só a conversão final
 * para `number` acontece, e ela é validada.
 */
function decimalToCents(value: Prisma.Decimal | number): number {
  const decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  const cents = decimal.mul(100).toDecimalPlaces(0).toNumber();

  if (!Number.isSafeInteger(cents)) {
    throw new RangeError('Valor monetário fora do intervalo seguro de centavos');
  }

  return cents;
}

/**
 * Seleciona, ordena e limita as faturas actionable de um usuário.
 *
 * Recebe todas as candidatas já carregadas (a authority não conhece Prisma
 * nem HTTP) e devolve a MENOR superfície pública: sem id, sem userId, sem
 * bankId, sem o objeto Bank inteiro, sem `totalAmount` bruto.
 *
 * A ordem das operações importa: filtrar → ordenar → limitar. Limitar antes
 * de ordenar devolveria itens arbitrários da consulta, não os mais urgentes.
 */
export function selectActionableInvoices(
  candidates: readonly ActionableInvoiceCandidate[],
  limit: number,
): ActionableInvoiceItem[] {
  const actionable = candidates.filter((candidate) => {
    if (STATUS_PRIORITY[candidate.status] === undefined) return false; // PAID
    const total =
      candidate.totalAmount instanceof Prisma.Decimal
        ? candidate.totalAmount
        : new Prisma.Decimal(candidate.totalAmount);
    return total.greaterThan(0);
  });

  const sorted = [...actionable].sort((a, b) => {
    const priorityDiff = STATUS_PRIORITY[a.status]! - STATUS_PRIORITY[b.status]!;
    if (priorityDiff !== 0) return priorityDiff;

    const dateDiff = actionDateOf(a).getTime() - actionDateOf(b).getTime();
    if (dateDiff !== 0) return dateDiff;

    return a.bankName.localeCompare(b.bankName);
  });

  return sorted.slice(0, limit).map((candidate) => {
    const totalAmount =
      candidate.totalAmount instanceof Prisma.Decimal
        ? candidate.totalAmount
        : new Prisma.Decimal(candidate.totalAmount);
    const reimbursable =
      candidate.reimbursable instanceof Prisma.Decimal
        ? candidate.reimbursable
        : new Prisma.Decimal(candidate.reimbursable);
    const ownAmount = totalAmount.minus(reimbursable);
    const actionDate = actionDateOf(candidate);

    return {
      bankName: candidate.bankName,
      status: candidate.status,
      closeDate: civilDay(candidate.closeDate),
      dueDate: civilDay(candidate.dueDate),
      actionDate: civilDay(actionDate),
      ownAmountCents: decimalToCents(ownAmount),
    };
  });
}

export const ACTIONABLE_INVOICES_DEFAULT_LIMIT = 3;
export const ACTIONABLE_INVOICES_MAX_LIMIT = 10;
