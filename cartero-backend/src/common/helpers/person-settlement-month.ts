/**
 * ══════════════════════════════════════════════════════════════════════════
 * Competência de acerto com uma pessoa
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O drawer de Person responde: **"quanto eu e esta pessoa temos para acertar
 * nesta competência?"** — uma pergunta MENSAL.
 *
 * Duas dimensões temporais coexistem, e confundi-las é o que tornava a tela
 * difícil de ler:
 *
 *   • `referenceMonth` — o mês a que o acerto PERTENCE conceitualmente
 *   • `dueMonth`       — o mês em que ele VENCE
 *
 * Para a maioria dos itens as duas coincidem. A exceção é o recebível
 * automático: ele nasce de uma compra no cartão, e a compra é o evento
 * financeiro que o originou. Um jantar dividido em 16/08 que vence com a
 * fatura em 10/09 pertence ao acerto de AGOSTO ("o que paguei para ela naquele
 * mês") e vence em SETEMBRO.
 *
 * Debt e recebível manual não têm esse evento de origem — para eles o
 * vencimento é a única referência disponível, e usar `occurredAt` misturaria
 * uma data de registro com uma competência de acerto.
 */

/** Competência mensal — inteiros, como em `Invoice` e `SalaryHistory`. */
export interface SettlementCompetence {
  year: number;
  month: number;
}

/** O mínimo para derivar as competências de um item. */
export interface SettleableItem {
  id: string;
  dueDate: Date;
  isPaid: boolean;
  paidAt?: Date | null;
  /** Presente só no recebível automático. */
  transactionId?: string | null;
  /** A compra que originou o recebível automático. */
  transaction?: { date: Date } | null;
}

/** `2026-08` — chave comparável e legível. */
export function competenceKey(c: SettlementCompetence): string {
  return `${c.year}-${String(c.month).padStart(2, '0')}`;
}

export function compareCompetence(
  a: SettlementCompetence,
  b: SettlementCompetence,
): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

/** Competência de uma data, em horário civil de Fortaleza (UTC-3). */
export function competenceOf(date: Date): SettlementCompetence {
  const local = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1 };
}

/**
 * Mês em que o item VENCE.
 *
 * Sempre derivado de `dueDate`, para todos os tipos.
 */
export function dueMonthOf(item: SettleableItem): SettlementCompetence {
  return competenceOf(item.dueDate);
}

/**
 * Mês a que o acerto PERTENCE.
 *
 * Recebível automático → data da compra de origem, obtida pela relação
 * estrutural (nunca por regex de título). Sem a relação carregada, cai no
 * vencimento: é conservador e nunca esconde o item.
 *
 * Debt e recebível manual → o próprio vencimento.
 */
export function referenceMonthOf(item: SettleableItem): SettlementCompetence {
  if (item.transactionId && item.transaction?.date) {
    return competenceOf(item.transaction.date);
  }
  return competenceOf(item.dueDate);
}

/** Rótulo temporal de um item em aberto, dentro de uma competência. */
export type DueState = 'overdue' | 'dueToday' | 'pending' | 'upcoming';

/**
 * Estado temporal de um item OPEN visto de uma competência.
 *
 * `upcoming` ("A vencer") não é status persistido: é a microcopy de um item que
 * veio de uma competência ANTERIOR e vence na selecionada, ainda no prazo.
 * Chamá-lo de "Em atraso" seria falso, e de "Pendente" perderia a informação
 * de que ele veio de antes.
 *
 * `today` é comparado por dia CIVIL: no próprio dia do vencimento o item ainda
 * não está atrasado — há o dia inteiro para resolvê-lo.
 */
export function dueStateOf(
  item: SettleableItem,
  selected: SettlementCompetence,
  today: Date = new Date(),
): DueState {
  const dueDay = competenceKeyWithDay(item.dueDate);
  const todayDay = competenceKeyWithDay(today);

  if (dueDay < todayDay) return 'overdue';
  if (dueDay === todayDay) return 'dueToday';

  // Ainda no prazo: distingue o que nasceu aqui do que veio de antes.
  const reference = referenceMonthOf(item);
  return compareCompetence(reference, selected) < 0 ? 'upcoming' : 'pending';
}

/** `2026-08-21` em horário civil — comparação lexicográfica = cronológica. */
function competenceKeyWithDay(date: Date): string {
  const local = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

/**
 * O item OPEN pertence ao universo da competência selecionada?
 *
 * União de três condições, deduplicada pela identidade do item:
 *
 *   A. nasceu na competência (`referenceMonth == selected`)
 *   B. veio de antes e vence nela (`dueMonth == selected`)
 *   C. já venceu antes do início dela e continua aberto (carry-over)
 *
 * A condição C é o que impede um atraso de junho desaparecer em setembro. E
 * como o retorno é booleano por item, o mesmo item nunca gera duas linhas
 * quando satisfaz mais de uma condição.
 */
export function belongsToCompetence(
  item: SettleableItem,
  selected: SettlementCompetence,
): boolean {
  if (item.isPaid) return false;

  const reference = referenceMonthOf(item);
  const due = dueMonthOf(item);

  // A. Originado na competência.
  if (compareCompetence(reference, selected) === 0) return true;

  // B. Ponte: veio de antes e vence aqui.
  if (compareCompetence(due, selected) === 0) return true;

  // C. Carry-over: venceu antes desta competência e segue aberto.
  if (compareCompetence(due, selected) < 0) return true;

  return false;
}

/**
 * Competência que o drawer deve abrir.
 *
 * Não é simplesmente o mês corrente: enquanto existir item aberto originado no
 * mês ANTERIOR que ainda não venceu, o acerto daquele mês continua em
 * andamento e é o que o usuário quer conferir. É o caso do jantar de agosto
 * que vence com a fatura em 10/09 — no começo de setembro o acerto de agosto
 * ainda está de pé.
 *
 * A busca olha apenas mês anterior e mês corrente: uma pendência de junho não
 * deve fazer o drawer abrir em junho — ela aparece como carry-over no mês
 * corrente.
 */
export function resolveDefaultCompetence(
  items: readonly SettleableItem[],
  today: Date = new Date(),
): SettlementCompetence {
  const current = competenceOf(today);
  const previous =
    current.month === 1
      ? { year: current.year - 1, month: 12 }
      : { year: current.year, month: current.month - 1 };

  const todayDay = competenceKeyWithDay(today);

  const previousStillInTime = items.some((item) => {
    if (item.isPaid) return false;
    if (compareCompetence(referenceMonthOf(item), previous) !== 0) return false;
    // "Ainda no prazo" inclui o próprio dia do vencimento.
    return competenceKeyWithDay(item.dueDate) >= todayDay;
  });

  return previousStillInTime ? previous : current;
}

/**
 * O item RESOLVIDO pertence ao histórico da competência selecionada?
 *
 * A competência canônica do arquivo é `referenceMonth`, não o mês de
 * `paidAt`. Uma dívida de julho paga em 15/09 pertence ao acerto de JULHO —
 * é ali que o usuário vai procurá-la ao revisar aquele mês.
 *
 * Arquivar por `paidAt` colocava o item no mês em que o dinheiro se moveu, o
 * que dispersava um mesmo acerto por vários meses conforme cada parte fosse
 * quitada, e tornava difícil reconstruir "o que combinamos em julho".
 *
 * `paidAt` continua sendo a data real da resolução e segue exibido na linha —
 * apenas deixou de escolher a prateleira.
 *
 * Uma competência só por item: nunca `referenceMonth` E `paidAtMonth`, senão
 * o mesmo acerto apareceria duas vezes no histórico.
 */
export function belongsToHistoryCompetence(
  item: SettleableItem,
  selected: SettlementCompetence,
): boolean {
  if (!item.isPaid) return false;
  return compareCompetence(referenceMonthOf(item), selected) === 0;
}
