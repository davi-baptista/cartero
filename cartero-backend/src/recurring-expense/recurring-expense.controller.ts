import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  InternalServerErrorException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from 'src/auth/current-user.decorator';
import type { AuthenticatedUser } from 'src/auth/authenticated-user';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CronSecretGuard } from 'src/auth/cron-secret.guard';
import { CreateRecurringExpenseDto } from './dto/create-recurring-expense.dto';
import { UpdateRecurringExpenseDto } from './dto/update-recurring-expense.dto';
import { ReconcileRecurringExpenseDto } from './dto/reconcile-recurring-expense.dto';
import { RecurringExpenseService } from './recurring-expense.service';

@Controller('recurring-expenses')
export class RecurringExpenseController {
  constructor(private readonly service: RecurringExpenseService) {}

  @Post('run-all')
  @HttpCode(200)
  @UseGuards(CronSecretGuard)
  async runAll() {
    const summary = await this.service.ensureAll();
    if (summary.usersFailed > 0) {
      throw new InternalServerErrorException({
        message: 'Recurring expense reconciliation finished with failures',
        code: 'RECURRING_EXPENSE_PARTIAL_FAILURE',
        summary,
      });
    }
    return summary;
  }

  @Post('reconcile')
  @UseGuards(JwtAuthGuard)
  reconcile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReconcileRecurringExpenseDto,
  ) {
    return this.service.reconcileForUserPeriod(user.id, dto.month, dto.year);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findAll(user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findOne(id, user.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRecurringExpenseDto,
  ) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateRecurringExpenseDto,
  ) {
    return this.service.update(id, user.id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.remove(id, user.id);
  }
}
