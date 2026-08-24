/**
 * ══════════════════════════════════════════════════════════════════════════
 * Competência de acerto com uma pessoa
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O drawer de Person responde: **"quanto eu e esta pessoa temos para acertar
 * nesta competência?"** — uma pergunta MENSAL.
 *
 * A competência canônica é UMA: o mês civil de `dueDate`. Vale igual para
 * Debt, recebível manual e recebível automático.
 *
 * A versão anterior distinguia `referenceMonth` (mês da compra de origem) de
 * `dueMonth`, e a tela mostrava o item nos DOIS meses: a compra de agosto que
 * vence em 10/09 aparecia em agosto como "Pendente · vence em 10/09" e em
 * setembro como "A vencer · referente a agosto". Tecnicamente coerente, mas
 * fazia a mesma obrigação parecer pertencer a duas competências — e nenhuma
 * das duas telas era claramente a certa para agir.
 *
 * A pergunta do drawer é "o que preciso acertar nesta competência?", e a
 * resposta é o que VENCE nela, mais o que já venceu e continua aberto.
 *
 * A data da compra não sumiu: `referenceMonthOf` segue disponível como
 * METADADO de origem (rótulo "No cartão", auditoria, PDF), apenas não decide
 * mais em que mês o item aparece.
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

/**
 * Rótulo temporal de um item em aberto.
 *
 * `upcoming` ("A vencer") foi REMOVIDO junto com a ponte por origem: ele
 * existia só para nomear o item que vinha de outra competência e ainda estava
 * no prazo. Com o vencimento como regra única, esse caso não existe — todo
 * item da competência vence nela.
 */
export type DueState = 'overdue' | 'dueToday' | 'pending';

/**
 * Estado temporal de um item OPEN.
 *
 * Depende só do vencimento contra hoje — `selected` não participa mais, e
 * permanece na assinatura para não quebrar os chamadores.
 *
 * O dia é CIVIL (America/Fortaleza): no próprio dia do vencimento o item
 * ainda não está atrasado, há o dia inteiro para resolvê-lo. O ano faz parte
 * da comparação, então out/2025 e out/2026 nunca colidem.
 */
export function dueStateOf(
  item: SettleableItem,
  selected: SettlementCompetence,
  today: Date = new Date(),
): DueState {
  const dueDay = competenceKeyWithDay(item.dueDate);
  const todayDay = competenceKeyWithDay(today);

  void selected;

  if (dueDay < todayDay) return 'overdue';
  if (dueDay === todayDay) return 'dueToday';
  return 'pending';
}

/** `2026-08-21` em horário civil — comparação lexicográfica = cronológica. */
function competenceKeyWithDay(date: Date): string {
  const local = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

/**
 * O item OPEN pertence ao universo da competência selecionada?
 *
 * DUAS condições, sobre uma competência canônica só (`dueMonth`):
 *
 *   A. vence na competência (`dueMonth == selected`)
 *   B. venceu antes E já está efetivamente vencido HOJE — o carry
 *
 * A ponte por origem foi REMOVIDA. Ela fazia a mesma obrigação aparecer em
 * dois meses: a compra de agosto que vence em 10/09 saía tanto no acerto de
 * agosto ("Pendente · vence em 10/09") quanto no de setembro ("A vencer ·
 * referente a agosto"), e nenhuma das duas telas era claramente a certa.
 *
 * A condição B compara com HOJE, não com o início da competência. Navegar
 * para setembro em 24/08 não pode transformar uma dívida que vence em 30/08
 * num atraso — ela ainda está no prazo, e projetar o estado futuro afirmaria
 * um fato que não aconteceu.
 *
 * O retorno é booleano por item, então nada gera duas linhas.
 */
export function belongsToCompetence(
  item: SettleableItem,
  selected: SettlementCompetence,
  today: Date = new Date(),
): boolean {
  if (item.isPaid) return false;

  const due = dueMonthOf(item);
  const posicao = compareCompetence(due, selected);

  // A. Vence nesta competência — mesmo que a data ainda esteja no futuro.
  if (posicao === 0) return true;

  // B. Carry: de competência anterior e JÁ vencido hoje.
  if (posicao < 0) {
    return competenceKeyWithDay(item.dueDate) < competenceKeyWithDay(today);
  }

  return false;
}

/**
 * Competência que o drawer deve abrir: o MÊS CIVIL CORRENTE.
 *
 * A versão anterior abria o mês passado enquanto existisse cobrança
 * automática originada nele e ainda no prazo. Fazia sentido quando a origem
 * definia a competência; com o vencimento como regra única, abrir agosto
 * porque a compra foi feita lá — quando o item vence em setembro e é lá que
 * ele aparece — só desorienta.
 *
 * A rota tem prioridade sobre isto: quando a URL informa uma competência
 * válida, ela vence, e navegação manual nunca sofre snap-back.
 */
export function resolveDefaultCompetence(
  today: Date = new Date(),
): SettlementCompetence {
  return competenceOf(today);
}

/**
 * O item RESOLVIDO pertence ao histórico da competência selecionada?
 *
 * A competência canônica do arquivo é `dueMonth` — a MESMA dos itens abertos.
 * Uma dívida que vence em 20/07 e é paga em 15/09 pertence ao acerto de
 * JULHO: é ali que o usuário vai procurá-la ao revisar aquele mês.
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
  return compareCompetence(dueMonthOf(item), selected) === 0;
}
