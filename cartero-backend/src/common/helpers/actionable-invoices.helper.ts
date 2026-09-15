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
 *
 * ── Empate determinístico (M5A.2) ──
 *
 * Duas invoices do MESMO banco podem legitimamente ter o mesmo `status` e a
 * mesma `actionDate` — nada no schema impede isso (`Invoice` não tem
 * `@@unique` sobre competência), e o cenário é alcançável por edição manual,
 * reconfiguração de ciclo ou correção de dado. Quando isso acontece, o
 * terceiro critério do comparador (`bankName`) empata TAMBÉM — é o mesmo
 * banco —, e a escolha da representante passava a depender da ordem em que
 * o array chegava. Essa ordem vinha de `prisma.invoice.findMany` SEM
 * `orderBy`: o Postgres não garante ordem sem isso, então o mesmo estado do
 * banco podia produzir respostas diferentes entre execuções.
 *
 * O desempate INTRA-banco é `year` → `month` → `invoiceId`:
 *
 *   - competência (`year`/`month`) é domínio financeiro real — a obrigação
 *     mais antiga é a que representa o banco quando a urgência empata. Isso é
 *     preferível a `createdAt`: `createdAt` é o momento em que a LINHA foi
 *     persistida, e diverge da competência depois de um import, seed,
 *     correção manual ou backfill. Usar `createdAt` faria o desempate
 *     depender de quando o dado foi gravado no Postgres, não de quando a
 *     obrigação financeira realmente é.
 *   - `invoiceId` entra só como ÚLTIMO fallback, para o caso (hoje possível,
 *     por falta de `@@unique`) de duas invoices da MESMA competência e MESMO
 *     status. Não tem significado financeiro — existe só para garantir que a
 *     mesma entrada lógica produza a mesma saída. Comparação lexical simples
 *     (`<`/`>`), sem depender de locale.
 *
 * O desempate INTER-bancos continua `bankName.localeCompare()` — a régua
 * histórica do M5A — com `bankId` como fallback técnico final para o caso de
 * dois bancos homônimos empatando em tudo mais.
 *
 * Nenhum desses campos (`bankId`, `invoiceId`, `year`, `month`) é exposto em
 * `ActionableInvoiceItem`.
 */

/** O que a authority precisa de cada fatura candidata. */
export interface ActionableInvoiceCandidate {
  /** Identidade do banco — usada SOMENTE para agrupar, nunca exposta. */
  bankId: string;
  bankName: string;
  /** Fallback técnico final de desempate — nunca exposto, sem significado financeiro. */
  invoiceId: string;
  /** Competência — desempate intra-banco. Nunca exposta. */
  year: number;
  month: number;
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
  /**
   * O bruto — o que o banco cobra no vencimento (M6.2). Campo ADITIVO: convive
   * com `ownAmountCents`, nunca o substitui. Consumidores que precisam de "sua
   * parte" continuam lendo `ownAmountCents`; quem precisa do valor que o banco
   * realmente cobra (ex.: Invoices Widget) lê este.
   */
  totalAmountCents: number;
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

/** Urgência pura: status, depois `actionDate`. Não decide nada sozinha — os
 * dois comparators abaixo a usam como primeiro critério e completam o
 * desempate de formas DIFERENTES (competência dentro do banco, nome entre
 * bancos), porque são perguntas diferentes. */
function compareActionableUrgency(
  a: ActionableInvoiceCandidate,
  b: ActionableInvoiceCandidate,
): number {
  const priorityDiff = STATUS_PRIORITY[a.status]! - STATUS_PRIORITY[b.status]!;
  if (priorityDiff !== 0) return priorityDiff;

  return actionDateOf(a).getTime() - actionDateOf(b).getTime();
}

/**
 * Escolhe a representante DENTRO de um mesmo banco.
 *
 * Depois da urgência, o desempate é a COMPETÊNCIA — a obrigação mais antiga
 * representa o banco — e só then `invoiceId` como fallback técnico sem
 * significado financeiro, para o caso de mesma competência e mesmo status
 * (hoje possível: `Invoice` não tem `@@unique` sobre competência).
 */
function compareWithinBank(
  a: ActionableInvoiceCandidate,
  b: ActionableInvoiceCandidate,
): number {
  const urgencyDiff = compareActionableUrgency(a, b);
  if (urgencyDiff !== 0) return urgencyDiff;

  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;

  // Comparação lexical simples — não depende de locale, e não tem
  // significado financeiro: só garante que a mesma entrada produza a mesma
  // saída.
  if (a.invoiceId < b.invoiceId) return -1;
  if (a.invoiceId > b.invoiceId) return 1;
  return 0;
}

/**
 * Ordena as representantes ENTRE bancos diferentes.
 *
 * Regra histórica do M5A, preservada: urgência, depois nome do banco
 * (`localeCompare`). `bankId` entra só como fallback técnico final, para o
 * caso (hoje possível) de dois bancos homônimos empatando em tudo mais —
 * sem ele, a ordem entre eles dependeria da entrada, o mesmo problema que
 * motivou este arquivo inteiro.
 */
function compareBankRepresentatives(
  a: ActionableInvoiceCandidate,
  b: ActionableInvoiceCandidate,
): number {
  const urgencyDiff = compareActionableUrgency(a, b);
  if (urgencyDiff !== 0) return urgencyDiff;

  const nameDiff = a.bankName.localeCompare(b.bankName);
  if (nameDiff !== 0) return nameDiff;

  if (a.bankId < b.bankId) return -1;
  if (a.bankId > b.bankId) return 1;
  return 0;
}

/**
 * Seleciona, ordena e limita as faturas actionable de um usuário.
 *
 * Recebe todas as candidatas já carregadas (a authority não conhece Prisma
 * nem HTTP) e devolve a MENOR superfície pública: sem id, sem userId, sem
 * bankId, sem o objeto Bank inteiro. `totalAmountCents` (M6.2) é a exceção
 * deliberada — o bruto passou a ser exposto ao lado de `ownAmountCents`,
 * nunca no lugar dele.
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

  // Uma representante por banco: a mais urgente do grupo — e, em empate de
  // urgência, a de competência mais antiga (ver comentário do módulo).
  const representatives = [...byBank.values()].map((group) =>
    group.reduce((best, current) => (compareWithinBank(current, best) < 0 ? current : best)),
  );

  const sorted = representatives.sort(compareBankRepresentatives);

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
      totalAmountCents: decimalToCents(totalAmount),
    };
  });
}

export const ACTIONABLE_INVOICES_DEFAULT_LIMIT = 3;
export const ACTIONABLE_INVOICES_MAX_LIMIT = 10;
