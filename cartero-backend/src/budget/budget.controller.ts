import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import type { AuthenticatedUser } from 'src/auth/authenticated-user';
import { BudgetService } from './budget.service';
import { GetBudgetDto } from './dto/get-budget.dto';

@Controller('budget')
@UseGuards(JwtAuthGuard)
export class BudgetController {
  constructor(private budgetService: BudgetService) {}

  /** Declarado antes de `@Get()` para não ser capturado por ele. */
  @Get('focus')
  getFocus(@CurrentUser() user: AuthenticatedUser) {
    return this.budgetService.getFocusPeriod(user.id);
  }

  @Get()
  findOne(@CurrentUser() user: AuthenticatedUser, @Query() filters: GetBudgetDto) {
    return this.budgetService.getBudget(user.id, filters.month, filters.year);
  }
}
