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
import type { User } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { FindInvoicesDto } from './dto/find-invoices.dto';
import { MarkManyPaidDto } from './dto/mark-many-paid.dto';

@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private invoicesService: InvoicesService) {}

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoicesService.update(id, user.id, dto);
  }

  // Rotas em lote antes de `:id`, senão o parâmetro as capturaria.
  @Post('reopen-all-paid')
  reopenAllPaid(@CurrentUser() user: User) {
    return this.invoicesService.reopenAllPaid(user.id);
  }

  @Post('mark-many-paid')
  markManyPaid(@CurrentUser() user: User, @Body() dto: MarkManyPaidDto) {
    return this.invoicesService.markManyPaid(user.id, dto.ids);
  }

  @Post(':id/reopen')
  reopen(@Param('id') id: string, @CurrentUser() user: User) {
    return this.invoicesService.reopen(id, user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.invoicesService.findOne(id, user.id);
  }

  @Get()
  findAll(@CurrentUser() user: User, @Query() filters: FindInvoicesDto) {
    return this.invoicesService.findAll(user.id, filters);
  }
}
