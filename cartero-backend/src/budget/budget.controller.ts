import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import type { User } from '@prisma/client';
import { BudgetService } from './budget.service';
import { GetBudgetDto } from './dto/get-budget.dto';

@Controller('budget')
@UseGuards(JwtAuthGuard)
export class BudgetController {
  constructor(private budgetService: BudgetService) {}

  @Get()
  findOne(@CurrentUser() user: User, @Query() filters: GetBudgetDto) {
    return this.budgetService.getBudget(user.id, filters.month, filters.year);
  }
}
