import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import type { User } from '@prisma/client';
import { SalaryService } from './salary.service';
import { GetSalaryDto } from './dto/get-salary.dto';
import { UpsertSalaryDto } from './dto/upsert-salary.dto';

/**
 * API mínima: resolver e definir.
 *
 * Não é um CRUD — não existe listagem nem delete. O histórico existe para
 * tornar os cálculos mensais corretos, não para ser administrado tela a tela.
 *
 * `userId` vem sempre da sessão, nunca do corpo ou da query.
 */
@Controller('salary')
@UseGuards(JwtAuthGuard)
export class SalaryController {
  constructor(private salaryService: SalaryService) {}

  @Get()
  resolve(@CurrentUser() user: User, @Query() query: GetSalaryDto) {
    return this.salaryService.resolve(user.id, {
      year: query.year,
      month: query.month,
    });
  }

  @Put()
  upsert(@CurrentUser() user: User, @Body() dto: UpsertSalaryDto) {
    return this.salaryService.upsert(user.id, dto);
  }
}
