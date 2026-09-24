import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import type { AuthenticatedUser } from 'src/auth/authenticated-user';
import { CreateRecurringIncomeDto } from './dto/create-recurring-income.dto';
import { UpdateRecurringIncomeDto } from './dto/update-recurring-income.dto';
import { RecurringIncomeService } from './recurring-income.service';

@Controller('recurring-incomes')
@UseGuards(JwtAuthGuard)
export class RecurringIncomeController {
  constructor(private readonly service: RecurringIncomeService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findAll(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findOne(id, user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRecurringIncomeDto,
  ) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateRecurringIncomeDto,
  ) {
    return this.service.update(id, user.id, dto);
  }

  @Delete(':id')
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.deactivate(id, user.id);
  }
}
