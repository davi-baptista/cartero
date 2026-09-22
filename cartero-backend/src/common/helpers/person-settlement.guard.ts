import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Group members can only be reopened by undoing the whole active group. */
export async function assertNotActivePersonSettlementMember(
  tx: Prisma.TransactionClient,
  kind: 'debt' | 'receivable',
  itemId: string,
  userId: string,
): Promise<void> {
  const membership =
    kind === 'debt'
      ? await tx.personSettlementDebt?.findFirst({
          where: { debtId: itemId, group: { userId, status: 'ACTIVE' } },
          select: { groupId: true },
        })
      : await tx.personSettlementReceivable?.findFirst({
          where: { receivableId: itemId, group: { userId, status: 'ACTIVE' } },
          select: { groupId: true },
        });

  if (membership) {
    throw new ConflictException({
      message:
        'Este item foi quitado junto com outros valores. Desfaça o acerto inteiro.',
      code: 'PERSON_SETTLEMENT_GROUP_UNDO_REQUIRED',
      settlementGroupId: membership.groupId,
    });
  }
}
