import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  Query,
  Delete,
} from '@nestjs/common';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import type { User } from '@prisma/client';
import { DebtsService } from './debts.service';
import { UpdateDebtDto } from './dto/update-debt.dto';
import { CreateDebtDto } from './dto/create-debt.dto';
import { FindDebtsDto } from './dto/find-debts.dto';

@Controller('debts')
@UseGuards(JwtAuthGuard)
export class DebtsController {
  constructor(private debtsService: DebtsService) {}

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.debtsService.findOne(id, user.id);
  }

  @Get()
  findAll(@CurrentUser() user: User, @Query() filters: FindDebtsDto) {
    return this.debtsService.findAll(user.id, filters);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateDebtDto) {
    return this.debtsService.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateDebtDto,
    @Query('scope') scope?: string,
  ) {
    return this.debtsService.update(id, user.id, dto, scope);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Query('scope') scope?: string,
  ) {
    return this.debtsService.remove(id, user.id, scope);
  }
}
