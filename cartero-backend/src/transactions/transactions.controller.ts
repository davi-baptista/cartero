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
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { FindTransactionsDto } from './dto/find-transactions.dto';
import { TransactionsService } from './transactions.service';
import { UpdateTransactionDto } from './dto/update-transaction.dto';

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private transactionsService: TransactionsService) {}

  
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.transactionsService.findOne(id, user.id);
  }
  
  @Get()
  findAll(@CurrentUser() user: User, @Query() filters: FindTransactionsDto) {
    return this.transactionsService.findAll(user.id, filters);
  }

  
  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateTransactionDto,
    @Query('scope') scope?: string,
  ) {
    return this.transactionsService.update(id, user.id, dto, scope);
  }
  
  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateTransactionDto) {
    return this.transactionsService.create(user.id, dto);
  }
  
  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Query('scope') scope?: string,
  ) {
    return this.transactionsService.remove(id, user.id, scope);
  }
}
