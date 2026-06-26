import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import type { User } from '@prisma/client';
import { InvoicesService } from './invoices.service';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { FindInvoicesDto } from './dto/find-invoices.dto';

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

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.invoicesService.findOne(id, user.id);
  }

  @Get()
  findAll(@CurrentUser() user: User, @Query() filters: FindInvoicesDto) {
    return this.invoicesService.findAll(user.id, filters);
  }
}
