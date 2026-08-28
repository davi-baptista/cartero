import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import type { User } from '@prisma/client';
import { PersonsService } from './persons.service';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { FindPersonsDto } from './dto/find-persons.dto';
import { GetStatementDto } from './dto/get-statement.dto';
import { SettlePersonDto } from './dto/settle-person.dto';
import { MonthlySummaryDto } from './dto/monthly-summary.dto';

@Controller('persons')
@UseGuards(JwtAuthGuard)
export class PersonsController {
  constructor(private PersonsService: PersonsService) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreatePersonDto) {
    return this.PersonsService.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdatePersonDto,
  ) {
    return this.PersonsService.update(id, user.id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.PersonsService.remove(id, user.id);
  }

  @Get(':id/statement')
  getStatement(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Query() filters: GetStatementDto,
  ) {
    return this.PersonsService.getStatement(id, user.id, filters);
  }

  @Post(':id/settle')
  settle(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: SettlePersonDto,
  ) {
    return this.PersonsService.settle(id, user.id, dto);
  }

  /*
    ANTES de `@Get(':id')`, obrigatoriamente.

    O Nest casa rotas na ordem de declaração: depois do parâmetro curinga,
    "monthly-summary" seria lido como um id de pessoa e o endpoint devolveria
    404 — sem nada indicando que a causa é a ordem.
  */
  @Get('monthly-summary')
  monthlySummary(@CurrentUser() user: User, @Query() dto: MonthlySummaryDto) {
    return this.PersonsService.monthlySummary(user.id, {
      year: dto.year,
      month: dto.month,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.PersonsService.findOne(id, user.id);
  }

  @Get()
  findAll(@CurrentUser() user: User, @Query() filters: FindPersonsDto) {
    return this.PersonsService.findAll(user.id, filters);
  }
}
