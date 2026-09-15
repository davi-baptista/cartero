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
 *
 * ── A unidade é o BANCO, não a fatura (M5A.1) ──
 *
 * `selectBankInvoice` no Web recebe TODAS as invoices e filtra por banco
 * internamente — é chamada uma vez por banco (dentro de
 * `orderBanksByUrgency`), e devolve NO MÁXIMO uma invoice representante por
 * banco. O M5A perdeu esse agrupamento: tratava cada invoice como candidata
 * independente, então um banco com OVERDUE + CLOSED + OPEN simultaneamente
 * actionable ocupava até três posições do `limit` sozinho — quando a unidade
 * de produto (evidenciada pela própria existência de `selectBankInvoice`) é
 * uma linha por banco.
 *
 * Nenhum teste do M5A original cobria isso: todo cenário testado tinha, no
 * máximo, uma invoice actionable por banco. E vale registrar a ressalva: essa
 * unidade não tem NENHUM caller de produção no Web hoje — `banks/page.tsx` usa
 * só `banksForPeriod` (a visão mensal). `selectBankInvoice`/
 * `orderBanksByUrgency` sobrevivem apenas nos próprios testes. Ainda assim são
 * a única evidência de intenção de produto para "o que exige atenção agora,
 * por banco" — e é o consumo que o futuro widget precisa (um card por
 * instituição, não três linhas do mesmo cartão).
 *
 * `bankId` agrupa — nunca `bankName`: dois bancos distintos podem ter o mesmo
 * nome, e agrupar por texto os fundiria incorretamente. `bankId` fica
 * INTERNO: não entra em `ActionableInvoiceItem`.
 */

/** O que a authority precisa de cada fatura candidata. */
export interface ActionableInvoiceCandidate {
  /** Identidade do banco — usada SOMENTE para agrupar, nunca exposta. */
  bankId: string;
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
 * A mesma régua usada para escolher a representante DENTRO de um banco e
 * para ordenar as representantes ENTRE bancos — `selectBankInvoice` e
 * `orderBanksByUrgency` usam exatamente o mesmo comparador no Web (prioridade
 * de status, depois `actionDate`, depois nome), e nada nesta fase encontrou
 * evidência de que as duas réguas devessem divergir.
 */
function compareActionable(
  a: ActionableInvoiceCandidate,
  b: ActionableInvoiceCandidate,
): number {
  const priorityDiff = STATUS_PRIORITY[a.status]! - STATUS_PRIORITY[b.status]!;
  if (priorityDiff !== 0) return priorityDiff;

  const dateDiff = actionDateOf(a).getTime() - actionDateOf(b).getTime();
  if (dateDiff !== 0) return dateDiff;

  return a.bankName.localeCompare(b.bankName);
}

/**
 * Seleciona, ordena e limita as faturas actionable de um usuário.
 *
 * Recebe todas as candidatas já carregadas (a authority não conhece Prisma
 * nem HTTP) e devolve a MENOR superfície pública: sem id, sem userId, sem
 * bankId, sem o objeto Bank inteiro, sem `totalAmount` bruto.
 *
 * A unidade é o BANCO (ver o comentário do módulo, M5A.1): no máximo uma
 * invoice representa cada banco, e é ela — não invoices soltas — que disputa
 * prioridade, `actionDate` e `limit` com as de outros bancos.
 *
 * A ordem das operações importa:
 *
 *   filtrar → agrupar por bankId → escolher 1 representante por grupo
 *   → ordenar representantes → limitar
 *
 * Nunca ordenar/limitar invoices soltas e só depois deduplicar por banco:
 * isso deixaria o `limit` reservar posições para o segundo/terceiro ciclo do
 * MESMO banco, tirando o lugar de um banco diferente que também precisa
 * aparecer.
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

  // Agrupar por bankId — NUNCA por bankName: dois bancos distintos do mesmo
  // usuário podem ter o mesmo nome, e agrupar por texto os fundiria.
  const byBank = new Map<string, ActionableInvoiceCandidate[]>();
  for (const candidate of actionable) {
    const group = byBank.get(candidate.bankId);
    if (group) group.push(candidate);
    else byBank.set(candidate.bankId, [candidate]);
  }

  // Uma representante por banco: a mais urgente do grupo, pela MESMA régua
  // usada para ordenar entre bancos — é o que `selectBankInvoice` faz no Web.
  const representatives = [...byBank.values()].map((group) =>
    group.reduce((best, current) => (compareActionable(current, best) < 0 ? current : best)),
  );

  const sorted = representatives.sort(compareActionable);

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
