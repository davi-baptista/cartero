import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import type { User } from '@prisma/client';
import { SalaryService } from './salary.service';
import { GetSalaryDto } from './dto/get-salary.dto';
import { UpsertSalaryDto } from './dto/upsert-salary.dto';
import { SalaryCompetenceParamsDto } from './dto/salary-competence-params.dto';
import { UpdateSalaryAmountDto } from './dto/update-salary-amount.dto';

/**
 * API deliberadamente pequena: resolver, definir, listar e corrigir.
 *
 * Continua não sendo um CRUD — não existe delete. O histórico existe para os
 * cálculos mensais ficarem corretos; `GET /salary/history` e o `PATCH` servem
 * ao caso concreto de "cadastrei janeiro errado", não a administrar timeline.
 *
 * `PATCH` é separado do `PUT` porque as intenções divergem no caso ausente:
 * definir aceita criar, corrigir não. Um `PUT` usado para editar transformaria
 * um mês digitado errado numa competência nova, mudando a renda resolvida de
 * todos os meses seguintes sem o usuário perceber.
 *
 * `userId` vem sempre da sessão, nunca do corpo, da query ou da URL.
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

  /*
    Rota estática ANTES da paramétrica: `@Get(':year/:month')` declarada
    primeiro capturaria `/salary/history` com `year: 'history'`.
  */
  @Get('history')
  list(@CurrentUser() user: User) {
    return this.salaryService.list(user.id);
  }

  @Put()
  upsert(@CurrentUser() user: User, @Body() dto: UpsertSalaryDto) {
    return this.salaryService.upsert(user.id, dto);
  }

  @Patch(':year/:month')
  updateAmount(
    @CurrentUser() user: User,
    @Param() params: SalaryCompetenceParamsDto,
    @Body() dto: UpdateSalaryAmountDto,
  ) {
    return this.salaryService.updateAmount(
      user.id,
      { year: params.year, month: params.month },
      dto.amount,
    );
  }
}
