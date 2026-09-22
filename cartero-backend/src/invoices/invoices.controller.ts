import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import type { AuthenticatedUser } from 'src/auth/authenticated-user';
import { InvoicesService } from './invoices.service';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { FindInvoicesDto } from './dto/find-invoices.dto';
import { MarkManyPaidDto } from './dto/mark-many-paid.dto';
import { FindActionableInvoicesDto } from './dto/find-actionable-invoices.dto';

@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private invoicesService: InvoicesService) {}

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoicesService.update(id, user.id, dto);
  }

  // Rotas em lote antes de `:id`, senão o parâmetro as capturaria.
  @Post('reopen-all-paid')
  reopenAllPaid(@CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.reopenAllPaid(user.id, user.timeZone);
  }

  @Post('mark-many-paid')
  markManyPaid(@CurrentUser() user: AuthenticatedUser, @Body() dto: MarkManyPaidDto) {
    return this.invoicesService.markManyPaid(user.id, dto, user.timeZone);
  }

  @Post(':id/reopen')
  reopen(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.reopen(id, user.id, user.timeZone);
  }

  // Estática, e ANTES de `:id` — senão `/invoices/actionable` seria
  // capturada como um `id` literal.
  @Get('actionable')
  findActionable(
    @CurrentUser() user: AuthenticatedUser,
    @Query() filters: FindActionableInvoicesDto,
  ) {
    return this.invoicesService.findActionable(user.id, filters.limit);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.findOne(id, user.id);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() filters: FindInvoicesDto) {
    return this.invoicesService.findAll(user.id, filters);
  }
}
