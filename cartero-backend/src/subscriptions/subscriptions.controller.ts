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
import type { User } from '@prisma/client';
import { TransactionType } from '@prisma/client';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CronSecretGuard } from 'src/notifications/cron-secret.guard';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private subscriptionsService: SubscriptionsService) {}

  /**
   * Gera os ciclos pendentes de todos os usuários. Protegido por segredo de
   * cron — declarado antes das rotas com `:id` para não ser capturado por elas.
   */
  @Post('run-all')
  @UseGuards(CronSecretGuard)
  runAll() {
    return this.subscriptionsService.runForAll();
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@CurrentUser() user: User) {
    return this.subscriptionsService.findAll(user.id);
  }

  /** Simula a geração — alimenta o aviso de início retroativo. */
  @Get('preview')
  @UseGuards(JwtAuthGuard)
  preview(
    @CurrentUser() user: User,
    @Query('bankId') bankId: string,
    @Query('dayOfMonth') dayOfMonth: string,
    @Query('startedAt') startedAt: string,
    @Query('type') type: TransactionType,
  ) {
    return this.subscriptionsService.previewFor(
      user.id,
      bankId,
      Number(dayOfMonth),
      startedAt,
      type,
    );
  }

  /** Rede de segurança chamada quando o app abre. */
  @Post('run')
  @UseGuards(JwtAuthGuard)
  run(@CurrentUser() user: User) {
    return this.subscriptionsService.runForUser(user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.subscriptionsService.findOne(id, user.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: User, @Body() dto: CreateSubscriptionDto) {
    return this.subscriptionsService.create(user.id, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    return this.subscriptionsService.update(id, user.id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.subscriptionsService.remove(id, user.id);
  }
}
