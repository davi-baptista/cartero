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
import { PreviewTransactionDto } from './dto/preview-transaction.dto';
import { PreviewUpdateTransactionDto } from './dto/preview-update-transaction.dto';

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private transactionsService: TransactionsService) {}

  /**
   * Consequências de uma criação, sem gravar nada.
   *
   * Declarada antes de `@Post()` para que a rota estática ganhe do handler de
   * criação — invertendo a ordem, `POST /transactions/preview` cairia nele.
   */
  @Post('preview')
  preview(@CurrentUser() user: User, @Body() dto: PreviewTransactionDto) {
    return this.transactionsService.previewCreate(user.id, dto);
  }

  /** Impacto projetado de uma edição, sem gravar nada. */
  @Post(':id/preview-update')
  previewUpdate(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: PreviewUpdateTransactionDto,
  ) {
    return this.transactionsService.previewUpdate(id, user.id, dto);
  }

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
