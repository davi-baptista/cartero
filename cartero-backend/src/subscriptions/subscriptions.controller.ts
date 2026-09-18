import {
  Body,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from 'src/auth/authenticated-user';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CronSecretGuard } from 'src/auth/cron-secret.guard';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { PreviewSubscriptionDto } from './dto/preview-subscription.dto';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private subscriptionsService: SubscriptionsService) {}

  /**
   * Gera os ciclos pendentes de todos os usuários — o cron diário.
   *
   * Protegido por segredo de cron, e declarado antes das rotas com `:id` para
   * não ser capturado por elas.
   *
   * ─── Por que uma falha parcial devolve 500 ───────────────────────────────
   *
   * Antes o retorno era sempre 201, mesmo com `failed > 0`. Um monitor externo
   * que observa status HTTP — que é o que serviços de cron oferecem —
   * concluía que a execução foi bem-sucedida, e uma assinatura podia falhar
   * todos os dias sem ninguém notar.
   *
   * `skipped` NÃO entra nessa conta: fatura já paga é decisão deliberada do
   * domínio, e alertar por isso treinaria quem monitora a ignorar o alerta.
   *
   * Nada é revertido. Os ciclos confirmados permanecem, e a idempotência
   * (`lastGeneratedFor` com update condicional, mais `creationKey` na criação)
   * garante que o retry provocado pelo status de erro não duplique nada — só
   * retoma o que ficou pendente.
   */
  @Post('run-all')
  @UseGuards(CronSecretGuard)
  async runAll() {
    const summary = await this.subscriptionsService.runForAll();

    if (summary.failed > 0) {
      // O corpo do erro carrega o MESMO resumo: quem investiga precisa ver
      // quantos ciclos passaram antes de a falha aparecer. As mensagens em
      // `failures` já vêm sanitizadas por `describeFailure` — sem stack, sem
      // erro cru do Prisma, sem segredo.
      throw new InternalServerErrorException({
        message: 'A geração de assinaturas terminou com falhas',
        code: 'SUBSCRIPTION_GENERATION_PARTIAL_FAILURE',
        summary,
      });
    }

    return summary;
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptionsService.findAll(user.id, new Date(), user.timeZone);
  }

  /**
   * Simula a geração — alimenta o aviso de início retroativo.
   *
   * Com DTO: parâmetros crus faziam `startedAt` inválido virar 500 (o `Error`
   * de `parseCycle` escapava sem tratamento) e `dayOfMonth` não numérico
   * produzir datas nulas em silêncio.
   */
  @Get('preview')
  @UseGuards(JwtAuthGuard)
  preview(@CurrentUser() user: AuthenticatedUser, @Query() query: PreviewSubscriptionDto) {
    return this.subscriptionsService.previewFor(
      user.id,
      query.bankId,
      query.dayOfMonth,
      query.startedAt,
      query.type,
      new Date(),
      user.timeZone,
    );
  }

  /** Rede de segurança chamada quando o app abre. */
  @Post('run')
  @UseGuards(JwtAuthGuard)
  run(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptionsService.runForUser(user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.subscriptionsService.findOne(
      id,
      user.id,
      new Date(),
      user.timeZone,
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSubscriptionDto) {
    return this.subscriptionsService.create(user.id, dto, user.timeZone);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    return this.subscriptionsService.update(id, user.id, dto, user.timeZone);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.subscriptionsService.remove(id, user.id);
  }
}
