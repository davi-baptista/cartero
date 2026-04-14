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
import { BanksService } from './banks.service';
import type { User } from '@prisma/client';
import { CreateBankDto } from './dto/create-bank.dto';
import { UpdateBankDto } from './dto/update-bank.dto';
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
  findAll(@CurrentUser() user: User) {
    return this.banksService.findAll(user.id);
  }

  @Get(':id/invoices')
  findInvoices(@Param('id') id: string, @CurrentUser() user: User) {
    return this.invoicesService.findAll(user.id, id);
  }
}
