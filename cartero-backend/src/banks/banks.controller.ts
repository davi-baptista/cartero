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
import { BanksService } from './banks.service';
import type { User } from '@prisma/client';
import { CreateBankDto } from './dto/create-bank.dto';
import { UpdateBankDto } from './dto/update-bank.dto';
import { FindBanksDto } from './dto/find-banks.dto';
import { InvoicesService } from 'src/invoices/invoices.service';

@Controller('banks')
@UseGuards(JwtAuthGuard)
export class BanksController {
  constructor(
    private banksService: BanksService,
    private invoicesService: InvoicesService,
  ) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateBankDto) {
    return this.banksService.create(user.id, dto);
  }

  /**
   * Arquivar e restaurar são ações de domínio, não campos editáveis.
   *
   * `isArchived` de propósito fora do `UpdateBankDto`: com `whitelist: true`
   * um `PATCH { isArchived: true }` é descartado silenciosamente, o que
   * garante que a mudança de estado passe sempre pelas guardas daqui
   * (banco de sistema, assinaturas ativas).
   */
  @Post(':id/archive')
  archive(@Param('id') id: string, @CurrentUser() user: User) {
    return this.banksService.archive(id, user.id);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: User) {
    return this.banksService.restore(id, user.id);
  }

  /**
   * Impacto de mudar o ciclo de faturamento, sem gravar nada.
   *
   * `POST` e não `GET` porque o corpo carrega a configuração pretendida — a
   * mesma forma já usada em `POST /transactions/:id/preview-update`.
   */
  @Post(':id/preview-billing-config')
  previewBillingConfig(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateBankDto,
  ) {
    return this.banksService.previewBillingConfig(id, user.id, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateBankDto,
  ) {
    return this.banksService.update(id, user.id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.banksService.remove(id, user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.banksService.findOne(id, user.id);
  }

  @Get()
  findAll(@CurrentUser() user: User, @Query() filters: FindBanksDto) {
    return this.banksService.findAll(user.id, filters.status);
  }

  @Get(':id/invoices')
  findInvoices(@Param('id') id: string, @CurrentUser() user: User) {
    return this.invoicesService.findAll(user.id, { bankId: id });
  }
}
