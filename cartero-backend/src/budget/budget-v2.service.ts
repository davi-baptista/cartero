import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { deriveBudgetV2Period } from 'src/common/helpers/financial-period.helper';
import { BudgetV2PeriodPreset, type BudgetV2Period } from './budget-v2.types';

@Injectable()
export class BudgetV2Service {
  constructor(private readonly prisma: PrismaService) {}

  async getPeriod(
    userId: string,
    preset: BudgetV2PeriodPreset = BudgetV2PeriodPreset.LAST_30_DAYS,
  ): Promise<BudgetV2Period> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timeZone: true },
    });

    return deriveBudgetV2Period(preset, user.timeZone);
  }
}
