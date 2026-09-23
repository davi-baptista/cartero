import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import type { AuthenticatedUser } from 'src/auth/authenticated-user';
import { BudgetService } from './budget.service';
import { GetBudgetDto } from './dto/get-budget.dto';
import { BudgetV2Service } from './budget-v2.service';
import { GetBudgetV2Dto } from './dto/get-budget-v2.dto';
import type { BudgetV2ResponseContract } from './budget-v2.types';
import { GetBudgetV2DrilldownDto } from './dto/get-budget-v2-drilldown.dto';
import { BudgetV2DrilldownService } from './budget-v2-drilldown.service';
import type { BudgetV2DrilldownResponse } from './budget-v2-drilldown.types';

@Controller('budget')
@UseGuards(JwtAuthGuard)
export class BudgetController {
  constructor(
    private budgetService: BudgetService,
    private budgetV2Service: BudgetV2Service,
    private budgetV2DrilldownService: BudgetV2DrilldownService,
  ) {}

  @Get('v2')
  getV2(
    @CurrentUser() user: AuthenticatedUser,
    @Query() filters: GetBudgetV2Dto,
  ): Promise<BudgetV2ResponseContract> {
    return this.budgetV2Service.getBudget(user.id, filters.preset);
  }

  @Get('v2/drilldown')
  getV2Drilldown(
    @CurrentUser() user: AuthenticatedUser,
    @Query() filters: GetBudgetV2DrilldownDto,
  ): Promise<BudgetV2DrilldownResponse> {
    return this.budgetV2DrilldownService.getDrilldown(user.id, filters);
  }

  /** Declarado antes de `@Get()` para não ser capturado por ele. */
  @Get('focus')
  getFocus(@CurrentUser() user: AuthenticatedUser) {
    return this.budgetService.getFocusPeriod(user.id);
  }

  @Get()
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Query() filters: GetBudgetDto,
  ) {
    return this.budgetService.getBudget(user.id, filters.month, filters.year);
  }
}
