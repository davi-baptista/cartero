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
import type { AuthenticatedUser } from 'src/auth/authenticated-user';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { FindTransactionsDto } from './dto/find-transactions.dto';
import { TransactionsService } from './transactions.service';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { PreviewTransactionDto } from './dto/preview-transaction.dto';
import { PreviewUpdateTransactionDto } from './dto/preview-update-transaction.dto';
import { DeleteTransactionDto } from './dto/delete-transaction.dto';

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
  preview(@CurrentUser() user: AuthenticatedUser, @Body() dto: PreviewTransactionDto) {
    return this.transactionsService.previewCreate(user.id, dto);
  }

  /** Impacto projetado de uma edição, sem gravar nada. */
  @Post(':id/preview-update')
  previewUpdate(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PreviewUpdateTransactionDto,
  ) {
    return this.transactionsService.previewUpdate(id, user.id, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transactionsService.findOne(id, user.id);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() filters: FindTransactionsDto) {
    return this.transactionsService.findAll(user.id, filters);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateTransactionDto,
    @Query('scope') scope?: string,
  ) {
    return this.transactionsService.update(id, user.id, dto, scope, user.timeZone);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTransactionDto) {
    return this.transactionsService.create(user.id, dto, user.timeZone);
  }

  /** O que a exclusão faria — sem gravar nada. */
  @Post(':id/preview-delete')
  previewDelete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transactionsService.previewDelete(id, user.id);
  }

  /**
   * `scope=OPEN` exclui as parcelas em aberto da série inteira.
   *
   * O conjunto confirmado viaja no BODY, não na query: são até dezenas de
   * UUIDs, e uma query com `expectedDeletableIds[]=…` repetido dezenas de
   * vezes esbarraria no limite de tamanho de URL de proxies e logs. O verbo
   * segue `DELETE` — a operação é a mesma, só a confirmação é mais rica.
   */
  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('scope') scope?: string,
    @Body() dto?: DeleteTransactionDto,
  ) {
    return this.transactionsService.remove(
      id,
      user.id,
      scope,
      dto?.expectedDeletableIds,
    );
  }
}
