import { ConflictException } from '@nestjs/common';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Integridade de pendências quitadas e cobranças derivadas
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Duas regras que Dívidas e A Receber compartilham, reunidas aqui para que
 * não divirjam — a auditoria encontrou proteções cuidadosas num sentido e
 * nada no inverso, e o custo disso foi divergência silenciosa.
 *
 * 1. Um registro QUITADO é fato financeiro concluído. Alterar o valor de uma
 *    dívida paga deixa o comprovante apontando para outro número.
 * 2. Uma cobrança AUTOMÁTICA é derivação de uma compra. Editá-la direto cria
 *    divergência que `syncLinkedReceivable` depois sobrescreve em silêncio —
 *    a edição do usuário é perdida sem aviso.
 */

/**
 * Campos que constituem o fato financeiro de uma dívida ou cobrança.
 *
 * Fora da lista ficam título, descrição e o alerta: texto e preferência, que
 * não contradizem uma quitação. É a mesma divisão adotada para a transação de
 * quitação e para a compra com recebível pago.
 */
export interface SettlementFacts {
  amount?: number;
  personId?: string | null;
  dueDate?: string;
  occurredAt?: string;
  creditorName?: string;
  debtorName?: string;
}

interface SettlementRecord {
  amount: unknown;
  personId: string | null;
  dueDate: Date;
  occurredAt: Date;
}

/** `true` quando o payload mexe em algum fato financeiro. */
export function changesSettlementFacts(
  dto: SettlementFacts,
  existing: SettlementRecord,
): boolean {
  if (dto.amount !== undefined && dto.amount !== Number(existing.amount)) {
    return true;
  }
  if (dto.personId !== undefined && dto.personId !== existing.personId) {
    return true;
  }
  if (
    dto.dueDate !== undefined &&
    dateOnly(dto.dueDate) !== existing.dueDate.getTime()
  ) {
    return true;
  }
  if (
    dto.occurredAt !== undefined &&
    dateOnly(dto.occurredAt) !== existing.occurredAt.getTime()
  ) {
    return true;
  }
  // Trocar a contraparte por nome livre também muda quem deve a quem.
  if (dto.creditorName !== undefined) return true;
  if (dto.debtorName !== undefined) return true;

  return false;
}

/** Mesma âncora de `parseDateOnly`: meio-dia UTC. */
function dateOnly(value: string): number {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return Date.UTC(year, month - 1, day, 12);
}

/**
 * Recusa alterar os fatos financeiros de uma DÍVIDA já paga.
 *
 * A saída é desfazer o pagamento, corrigir e marcar de novo — em vez de
 * deixar o registro dizer que R$ 100 foram pagos quando o comprovante diz
 * R$ 500.
 */
export function assertDebtNotPaid(
  debt: { isPaid: boolean },
  dto: SettlementFacts,
  existing: SettlementRecord,
): void {
  if (!debt.isPaid) return;
  if (!changesSettlementFacts(dto, existing)) return;

  throw new ConflictException({
    message:
      'Esta dívida já está paga. Desfaça o pagamento antes de alterar seus dados financeiros.',
    code: 'PAID_DEBT_EDIT_BLOCKED',
  });
}

/**
 * Recusa alterar os fatos financeiros de uma COBRANÇA já recebida.
 *
 * Vale para manual e automática: em ambos os casos existe uma transação de
 * recebimento cujo valor precisa continuar correspondendo.
 */
export function assertReceivableNotReceived(
  receivable: { isPaid: boolean },
  dto: SettlementFacts,
  existing: SettlementRecord,
): void {
  if (!receivable.isPaid) return;
  if (!changesSettlementFacts(dto, existing)) return;

  throw new ConflictException({
    message:
      'Esta cobrança já foi recebida. Desfaça o recebimento antes de alterar seus dados financeiros.',
    code: 'PAID_RECEIVABLE_EDIT_BLOCKED',
  });
}

/**
 * Recusa editar os fatos financeiros de uma cobrança AUTOMÁTICA.
 *
 * A compra é a fonte de verdade: valor, pessoa e vencimento vêm dela, e
 * `syncLinkedReceivable` os reescreve na próxima edição da transação. Aceitar
 * a edição aqui daria ao usuário a impressão de ter corrigido algo que será
 * descartado depois, sem aviso.
 *
 * O caminho certo é editar a compra, e a mensagem diz isso.
 */
export function assertNotAutomaticReceivable(
  receivable: { transactionId: string | null },
  dto: SettlementFacts,
  existing: SettlementRecord,
): void {
  if (!receivable.transactionId) return;
  if (!changesSettlementFacts(dto, existing)) return;

  throw new ConflictException({
    message:
      'Esta cobrança foi criada por uma compra. Edite a compra de origem para alterar valor, pessoa ou vencimento.',
    code: 'AUTOMATIC_RECEIVABLE_MANAGED_BY_TRANSACTION',
  });
}

/**
 * Recusa EXCLUIR diretamente uma cobrança automática.
 *
 * Excluir a cobrança sem tocar a compra deixaria a transação com `personId`
 * preenchido e nenhuma cobrança correspondente — a automação do Cartero
 * quebrada, e sem nada que a reconstrua.
 *
 * Os caminhos válidos continuam sendo: remover a pessoa da compra, trocar a
 * pessoa, ou excluir a compra.
 */
export function assertAutomaticReceivableNotDeleted(receivable: {
  transactionId: string | null;
}): void {
  if (!receivable.transactionId) return;

  throw new ConflictException({
    message:
      'Esta cobrança foi criada por uma compra. Edite ou exclua a compra de origem para removê-la.',
    code: 'AUTOMATIC_RECEIVABLE_MANAGED_BY_TRANSACTION',
  });
}
