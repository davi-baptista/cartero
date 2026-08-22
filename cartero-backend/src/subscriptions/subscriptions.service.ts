import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Bank, Prisma, Subscription, TransactionType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { EntityValidationService } from 'src/common/entity-validation.service';
import {
  findOrCreateInvoice,
  getInvoicePeriodForDate,
} from 'src/common/helpers/invoice.helper';
import {
  chargeDateForCycle,
  formatCycle,
  nextChargeDate,
  pendingCycles,
  resumeCycle,
} from 'src/common/helpers/subscription.helper';
import {
  SUBSCRIPTION_CATEGORY_COLOR,
  SUBSCRIPTION_CATEGORY_NAME,
  SYSTEM_CATEGORY_ICON,
} from 'src/common/constants/system-categories';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

/**
 * Por que um ciclo não gerou lançamento.
 *
 * A distinção que importa: `invoice-paid` e `bank-archived` são decisões
 * deliberadas — nada a corrigir. `failed` é o oposto: algo deu errado e
 * alguém precisa saber. Antes os dois casos se pareciam (um `return []`
 * silencioso), e uma assinatura podia perder meses sem deixar rastro.
 */
export type GenerationSkipReason =
  | 'invoice-paid'
  | 'bank-archived'
  | 'bank-missing';

/** O que uma geração produziu — usado no preview e no resultado do run. */
export interface GenerationPlanItem {
  cycle: string;
  date: Date;
  /** Faturas já pagas são puladas: o usuário já conciliou aquele mês na mão. */
  skipped: boolean;
  skipReason?: GenerationSkipReason;
}

/**
 * Resultado da geração de UMA assinatura.
 *
 * `failed` separa "não havia nada a fazer" de "não consegui fazer" — a
 * ausência dessa distinção era o silêncio operacional: um erro de geração
 * chegava ao usuário como se tudo estivesse em ordem.
 */
export interface SubscriptionRunResult {
  subscriptionId: string;
  title: string;
  generated: GenerationPlanItem[];
  /** Preenchido quando a geração abortou; a mensagem é legível ao usuário. */
  failure?: { reason: string };
}

/**
 * Resultado da criação: o cadastro E o que a geração produziu, separados.
 *
 * A separação é o ponto. Antes a criação devolvia a assinatura com uma lista
 * de ciclos, e uma falha na geração virava 500 — o cliente concluía que nada
 * foi criado e tentava de novo. Agora a assinatura sempre volta quando existe,
 * e o resumo diz a verdade sobre os lançamentos.
 */
export interface SubscriptionCreateResult {
  subscription: Awaited<ReturnType<SubscriptionsService['findOne']>>;
  generation: GenerationSummary;
  /** `true` quando a chave de criação recuperou uma assinatura existente. */
  alreadyExisted: boolean;
}

/**
 * Quem disparou a geração.
 *
 * Três executores legítimos convivem, e a idempotência garante que nenhum
 * duplique o trabalho do outro. Sem essa etiqueta, o log não dizia se um erro
 * recorrente vinha do cron diário ou de alguém abrindo o app — o que muda
 * inteiramente o diagnóstico.
 */
export type GenerationSource = 'external-cron' | 'dashboard' | 'scheduler';

/** Resumo de uma execução em lote. */
export interface GenerationSummary {
  subscriptions: number;
  generated: number;
  skipped: number;
  failed: number;
  /** Detalhe mínimo das falhas, para a interface orientar o usuário. */
  failures: Array<{ subscriptionId: string; title: string; reason: string }>;
}

/**
 * Outra execução já reivindicou este ciclo.
 *
 * Sentinela interna, nunca exposta: sinaliza perda de corrida na trava
 * condicional de `lastGeneratedFor`. Não é falha de geração — é a prova de
 * que a proteção contra duplicidade funcionou.
 */
class CycleAlreadyClaimedError extends Error {
  constructor() {
    super('Ciclo já reivindicado por outra execução');
  }
}

@Injectable()
export class SubscriptionsService {
  /**
   * A geração roda sem ninguém olhando — cron diário e mount do dashboard.
   * Sem log, uma falha recorrente ficava invisível: o serviço não tinha
   * Logger, `runForAll` só devolvia agregados e o cliente engolia o erro.
   */
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private prisma: PrismaService,
    private entityValidation: EntityValidationService,
  ) {}

  /**
   * Assinaturas do usuário, cada uma com a próxima cobrança já calculada.
   *
   * `nextCharge` vem do backend porque a regra é a MESMA que decide a geração
   * — `pendingCycles` mais o marco de ativação. Calcular no frontend criaria
   * um segundo algoritmo, e ele divergiria assim que a política de pausa
   * mudasse. Pausada devolve `null`: não existe próxima cobrança, e inventar
   * uma data seria mentir sobre o estado.
   */
  async findAll(userId: string, now: Date = new Date()) {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { userId },
      include: { bank: true, category: true },
      orderBy: [{ isActive: 'desc' }, { dayOfMonth: 'asc' }],
    });

    return subscriptions.map((subscription) => ({
      ...subscription,
      nextCharge: nextChargeDate(subscription, now),
    }));
  }

  async findOne(id: string, userId: string, now: Date = new Date()) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { id, userId },
      include: { bank: true, category: true },
    });
    if (!subscription) throw new NotFoundException('Assinatura não encontrada');
    return { ...subscription, nextCharge: nextChargeDate(subscription, now) };
  }

  /**
   * Cria a assinatura e reconcilia os ciclos pendentes.
   *
   * ─── Duas operações, não uma ─────────────────────────────────────────────
   *
   * A assinatura é um cadastro; os lançamentos são derivados dela. A criação
   * NÃO envolve as duas num `$transaction` único de propósito: uma criação com
   * `startedAt` retroativo pode gerar 15 ciclos, e cada um confirmado
   * isoladamente tem uma propriedade que vale preservar — se o ciclo 7 falha,
   * os 6 anteriores continuam válidos e a próxima execução retoma do marcador.
   * Um bloco all-or-nothing desfaria trabalho bom por causa de uma falha
   * pontual, e ainda manteria uma transação longa aberta.
   *
   * O que se corrige aqui é outra coisa: antes, falha na geração devolvia erro
   * com a assinatura já persistida, e o retry criava uma segunda. Agora a
   * resposta separa o que foi criado do que foi gerado, e `creationKey` faz o
   * retry recuperar a mesma assinatura.
   */
  async create(
    userId: string,
    dto: CreateSubscriptionDto,
  ): Promise<SubscriptionCreateResult> {
    await this.entityValidation.validateBank(dto.bankId, userId);

    const category = await this.resolveCategory(userId, dto.categoryId);

    const { subscription, alreadyExisted } = await this.claimSubscription(
      userId,
      dto,
      category.id,
    );

    /**
     * A geração é reconciliada mesmo quando a assinatura já existia.
     *
     * É o que faz o retry funcionar: os ciclos já gerados são ignorados por
     * `lastGeneratedFor`, e o que falhou na primeira tentativa é retomado. Sem
     * isso, um retry devolveria a assinatura sem completar o que ficou pelo
     * caminho.
     */
    const generation = await this.reconcile(subscription, alreadyExisted);

    return {
      subscription: await this.findOne(subscription.id, userId),
      generation,
      alreadyExisted,
    };
  }

  /**
   * Garante UMA assinatura por chave de criação.
   *
   * `findFirst` seguido de `create` teria race: duas requisições simultâneas
   * com a mesma chave passariam as duas pela busca vazia e criariam duas
   * linhas. A garantia vem do índice `(userId, creationKey)` no banco — a
   * segunda inserção falha com P2002, e aí a linha vencedora é recuperada.
   *
   * Sem chave (cliente antigo, chamada direta) o comportamento é o anterior:
   * cria sempre. Múltiplos nulos convivem no índice.
   */
  private async claimSubscription(
    userId: string,
    dto: CreateSubscriptionDto,
    categoryId: string,
  ): Promise<{ subscription: Subscription; alreadyExisted: boolean }> {
    const data = {
      userId,
      bankId: dto.bankId,
      categoryId,
      title: dto.title,
      type: dto.type,
      amount: dto.amount,
      description: dto.description,
      dayOfMonth: dto.dayOfMonth,
      startedAt: dto.startedAt,
      creationKey: dto.creationKey,
    };

    try {
      return {
        subscription: await this.prisma.subscription.create({ data }),
        alreadyExisted: false,
      };
    } catch (error) {
      const existing = dto.creationKey
        ? await this.findByCreationKey(userId, dto.creationKey, error)
        : null;

      if (existing) return { subscription: existing, alreadyExisted: true };
      throw error;
    }
  }

  /**
   * Recupera a assinatura de uma chave que perdeu a corrida de inserção.
   *
   * Só trata P2002 — qualquer outro erro do Prisma é problema de verdade e
   * volta a subir. Expor o código cru ao usuário não ajudaria ninguém.
   */
  private async findByCreationKey(
    userId: string,
    creationKey: string,
    error: unknown,
  ): Promise<Subscription | null> {
    const isUniqueViolation =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002';
    if (!isUniqueViolation) return null;

    return await this.prisma.subscription.findFirst({
      where: { userId, creationKey },
    });
  }

  /**
   * Roda os ciclos pendentes, transformando falha em resultado observável.
   *
   * A criação não pode devolver 500 por causa da geração: a assinatura existe,
   * e dizer o contrário levaria o usuário a cadastrá-la de novo. O erro vira
   * `failed` no resumo, e o ciclo continua pendente para a próxima execução.
   */
  private async reconcile(
    subscription: Subscription,
    alreadyExisted: boolean,
  ): Promise<GenerationSummary> {
    const summary: GenerationSummary = {
      subscriptions: 1,
      generated: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    };

    try {
      const items = await this.runForSubscription(subscription);
      summary.generated = items.filter((item) => !item.skipped).length;
      summary.skipped = items.filter((item) => item.skipped).length;
    } catch (error) {
      const reason = this.describeFailure(error);
      summary.failed = 1;
      summary.failures.push({
        subscriptionId: subscription.id,
        title: subscription.title,
        reason,
      });
      this.logger.error(
        `Falha ao gerar ciclos ${alreadyExisted ? 'no retry' : 'na criação'} da assinatura ${subscription.id}: ${reason}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    return summary;
  }

  /**
   * Categoria do lançamento gerado.
   *
   * Escolhida pelo usuário quando informada — `validateCategory` garante a
   * posse, porque um id vindo do corpo da requisição não prova nada. Omitida,
   * cai na categoria de sistema "Assinatura", que mantém o cadastro rápido e
   * deixa os lançamentos identificáveis no extrato.
   *
   * O `findOrCreateSystemCategory` é reusado em vez de buscar por nome: ele já
   * trata unicidade `(userId, name)` e não cria uma segunda "Assinatura".
   */
  private async resolveCategory(userId: string, categoryId?: string) {
    if (categoryId) {
      return await this.entityValidation.validateCategory(categoryId, userId);
    }

    return await this.entityValidation.findOrCreateSystemCategory(
      this.prisma,
      userId,
      SUBSCRIPTION_CATEGORY_NAME,
      SYSTEM_CATEGORY_ICON,
      SUBSCRIPTION_CATEGORY_COLOR,
    );
  }

  async update(id: string, userId: string, dto: UpdateSubscriptionDto) {
    const current = await this.findOne(id, userId);

    if (dto.bankId)
      await this.entityValidation.validateBank(dto.bankId, userId);

    /**
     * Reativar uma assinatura cujo banco foi arquivado.
     *
     * O banco pode ter sido arquivado justamente porque a assinatura estava
     * pausada — arquivar exige que nenhuma esteja ativa. Reativá-la sem
     * informar outro banco voltaria a gerar lançamentos numa conta encerrada,
     * e o payload `{ isActive: true }` não passa por nenhuma validação de
     * banco, então esta era a porta aberta.
     */
    const reactivating = dto.isActive === true && !current.isActive;
    if (reactivating && !dto.bankId) {
      await this.entityValidation.validateBank(current.bankId, userId);
    }

    // Trocar a categoria exige posse; o id vem do corpo da requisição.
    if (dto.categoryId) {
      await this.entityValidation.validateCategory(dto.categoryId, userId);
    }

    /**
     * Marco da ativação atual, gravado só ao REATIVAR.
     *
     * É o que impede o catch-up: sem ele, `pendingCycles` partia de
     * `lastGeneratedFor + 1` e gerava todos os meses da pausa de uma vez.
     * `startedAt` permanece intocado — ele significa "assinando desde", e
     * sobrescrevê-lo aqui apagaria a origem da assinatura.
     *
     * O ciclo vem de `resumeCycle`, que decide pelo dia civil: se o dia da
     * cobrança do mês corrente já passou, o primeiro elegível é o mês
     * seguinte, então reativar nunca cria uma cobrança de surpresa.
     */
    const activeSince = reactivating
      ? formatCycle(resumeCycle(dto.dayOfMonth ?? current.dayOfMonth))
      : undefined;

    // Campo a campo de propósito: `startedAt` e `lastGeneratedFor` não podem
    // ser alterados por payload — recuar o início geraria lançamentos sobre o
    // que já existe, e mexer no marcador de idempotência duplicaria cobranças.
    // `activeSince` só é escrito pela lógica de reativação acima, nunca pelo
    // corpo da requisição.
    await this.prisma.subscription.update({
      where: { id },
      data: {
        title: dto.title,
        bankId: dto.bankId,
        categoryId: dto.categoryId,
        type: dto.type,
        amount: dto.amount,
        description: dto.description,
        dayOfMonth: dto.dayOfMonth,
        isActive: dto.isActive,
        // `undefined` quando não é reativação: o Prisma trata como
        // "não alterar", preservando o marco de uma ativação anterior.
        activeSince,
        updatedAt: new Date(),
      },
    });

    return this.findOne(id, userId);
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId);
    // Os lançamentos já criados permanecem — o FK é ON DELETE SET NULL, então
    // eles apenas deixam de apontar para a regra.
    await this.prisma.subscription.delete({ where: { id } });
    return { id };
  }

  /**
   * Simula a geração sem escrever nada. Alimenta o aviso mostrado antes de
   * criar uma assinatura com início retroativo.
   */
  async previewFor(
    userId: string,
    bankId: string,
    dayOfMonth: number,
    startedAt: string,
    type: TransactionType,
    now: Date = new Date(),
  ): Promise<GenerationPlanItem[]> {
    // `null` nos dois últimos: o preview de CRIAÇÃO não tem histórico nem
    // marco de ativação — é uma assinatura que ainda não existe.
    const cycles = pendingCycles(startedAt, null, dayOfMonth, now, null);
    if (cycles.length === 0) return [];

    const bank = await this.entityValidation.validateBank(bankId, userId);
    const plan: GenerationPlanItem[] = [];

    for (const cycle of cycles) {
      const date = chargeDateForCycle(cycle, dayOfMonth);
      const paid =
        type === TransactionType.CREDIT_CARD &&
        (await this.isInvoicePaid(userId, bank, date));
      plan.push({
        cycle: formatCycle(cycle),
        date,
        skipped: paid,
        skipReason: paid ? 'invoice-paid' : undefined,
      });
    }

    return plan;
  }

  /**
   * Gera os ciclos pendentes de todas as assinaturas ativas do usuário.
   *
   * Uma falha isolada NÃO interrompe as demais. Antes o `await` estava nu
   * dentro do laço: uma única assinatura com dado corrompido (um ciclo
   * `"2026-13"` faz `parseCycle` lançar) abortava o lote inteiro, sempre no
   * mesmo registro, e o erro chegava ao cliente como um 500 genérico.
   *
   * Devolve também as que falharam, para a interface poder dizer o que não
   * funcionou em vez de fingir sucesso.
   */
  async runForUser(
    userId: string,
    now: Date = new Date(),
    source: GenerationSource = 'dashboard',
  ): Promise<SubscriptionRunResult[]> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { userId, isActive: true },
    });

    const results: SubscriptionRunResult[] = [];

    for (const subscription of subscriptions) {
      try {
        const generated = await this.runForSubscription(subscription, now);
        if (generated.length > 0) {
          results.push({
            subscriptionId: subscription.id,
            title: subscription.title,
            generated,
          });
        }
      } catch (error) {
        const reason = this.describeFailure(error);
        results.push({
          subscriptionId: subscription.id,
          title: subscription.title,
          generated: [],
          failure: { reason },
        });
        // Também no caminho por usuário: sem log, uma falha aqui só existia
        // como toast no navegador de quem abriu o app.
        this.logger.error(
          `[${source}] Falha ao gerar assinatura ${subscription.id}: ${reason}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return results;
  }

  /**
   * Mensagem de falha legível, sem vazar interno.
   *
   * Erro cru do Prisma ou stack trace não ajudam quem lê e expõem estrutura
   * de banco. As exceções de domínio (banco arquivado, por exemplo) já vêm
   * com texto escrito para o usuário e são preservadas.
   */
  private describeFailure(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'string') return response;
      if (
        response &&
        typeof response === 'object' &&
        'message' in response &&
        typeof (response as { message: unknown }).message === 'string'
      ) {
        return (response as { message: string }).message;
      }
    }
    return 'Não foi possível gerar as cobranças desta assinatura.';
  }

  /**
   * Gera os pendentes de TODOS os usuários — o cron diário.
   *
   * Era o ponto mais frágil do ciclo: `await` nu no laço, sem log. Uma
   * assinatura com ciclo inválido derrubava a geração de todos os usuários,
   * todos os dias, sempre no mesmo registro — e como `findMany` não garante
   * ordem, nem havia por onde começar a investigar. Nada era registrado.
   *
   * Agora cada assinatura é isolada, o resumo conta o que gerou, o que foi
   * pulado e o que falhou, e cada falha vira uma linha de log com o id e o
   * motivo.
   */
  async runForAll(
    now: Date = new Date(),
    source: GenerationSource = 'external-cron',
  ): Promise<GenerationSummary> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { isActive: true },
    });

    const summary: GenerationSummary = {
      subscriptions: subscriptions.length,
      generated: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    };

    for (const subscription of subscriptions) {
      try {
        const items = await this.runForSubscription(subscription, now);
        summary.generated += items.filter((item) => !item.skipped).length;
        summary.skipped += items.filter((item) => item.skipped).length;
      } catch (error) {
        summary.failed += 1;
        const reason = this.describeFailure(error);
        summary.failures.push({
          subscriptionId: subscription.id,
          title: subscription.title,
          reason,
        });
        // `stack` no segundo argumento: o Nest o imprime separado da
        // mensagem, então a linha continua legível.
        this.logger.error(
          `[${source}] Falha ao gerar assinatura ${subscription.id} (${subscription.title}): ${reason}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    if (summary.failed > 0) {
      this.logger.warn(
        `[${source}] Geração concluída com falhas: ${summary.generated} gerado(s), ${summary.skipped} pulado(s), ${summary.failed} com falha`,
      );
    }

    return summary;
  }

  /** A fatura vem da data da cobrança, não do ciclo — ver `runForSubscription`. */
  private async isInvoicePaid(
    userId: string,
    bank: Pick<Bank, 'id' | 'invoiceDueDate' | 'invoiceDueDaysAfterClose'>,
    chargeDate: Date,
  ): Promise<boolean> {
    const { year, month } = getInvoicePeriodForDate(
      {
        invoiceDueDate: bank.invoiceDueDate,
        invoiceDueDaysAfterClose: bank.invoiceDueDaysAfterClose,
      },
      chargeDate,
    );
    const invoice = await this.prisma.invoice.findFirst({
      where: { userId, bankId: bank.id, year, month },
      select: { status: true },
    });
    return invoice?.status === 'PAID';
  }

  /**
   * Gera os ciclos que faltam para uma assinatura. Idempotente: o avanço de
   * `lastGeneratedFor` acontece na mesma transação do lançamento, então rodar
   * duas vezes no mesmo dia não duplica nada.
   */
  private async runForSubscription(
    subscription: Subscription,
    now: Date = new Date(),
  ): Promise<GenerationPlanItem[]> {
    const cycles = pendingCycles(
      subscription.startedAt,
      subscription.lastGeneratedFor,
      subscription.dayOfMonth,
      now,
      subscription.activeSince,
    );
    if (cycles.length === 0) return [];

    const bank = await this.prisma.bank.findFirst({
      where: { id: subscription.bankId, userId: subscription.userId },
    });

    /**
     * Banco arquivado não gera movimento novo, nem pelo cron.
     *
     * Antes era um `return []` mudo: o motivo se perdia, e a assinatura
     * parecia saudável enquanto deixava de lançar. Agora cada ciclo suprimido
     * volta como item explícito, e o log registra a supressão — arquivar já
     * bloqueia assinaturas ativas, então chegar aqui significa que algum
     * caminho escapou e alguém precisa saber.
     */
    if (!bank || bank.isArchived) {
      const reason: GenerationSkipReason = !bank
        ? 'bank-missing'
        : 'bank-archived';
      this.logger.warn(
        `Assinatura ${subscription.id}: ${cycles.length} ciclo(s) suprimidos (${reason})`,
      );
      return cycles.map((cycle) => ({
        cycle: formatCycle(cycle),
        date: chargeDateForCycle(cycle, subscription.dayOfMonth),
        skipped: true,
        skipReason: reason,
      }));
    }

    const plan: GenerationPlanItem[] = [];

    /**
     * Valor de `lastGeneratedFor` que esta execução espera encontrar.
     *
     * A idempotência depende de um update CONDICIONAL: `pendingCycles` roda
     * fora da transação, então duas execuções simultâneas (cron e o runner do
     * dashboard, por exemplo) leem o mesmo marcador e ambas concluem que o
     * mesmo ciclo está pendente. Com `where: { id }` puro, as duas gravavam e
     * as duas criavam o lançamento — cobrança duplicada.
     *
     * Condicionando o update ao valor lido, só a primeira encontra a linha; a
     * segunda recebe `count: 0`, aborta a transação e não lança nada.
     */
    let expectedMarker = subscription.lastGeneratedFor;

    for (const cycle of cycles) {
      const date = chargeDateForCycle(cycle, subscription.dayOfMonth);
      const markerBefore = expectedMarker;

      let item: GenerationPlanItem;
      try {
        item = await this.prisma.$transaction(
          async (tx): Promise<GenerationPlanItem> => {
            let invoiceId: string | undefined;

            if (subscription.type === TransactionType.CREDIT_CARD) {
              // A fatura sai da DATA da cobrança, igual a qualquer compra: o
              // ciclo é o mês em que a assinatura cobra, e a fatura leva o mês
              // do vencimento — uma cobrança no fim de julho pertence à fatura
              // de agosto. Usar o ciclo como período apontava para a fatura
              // errada, geralmente uma anterior já paga.
              //
              // Isso não reabre o risco do dia 31: a idempotência vem de
              // `lastGeneratedFor`, que é por ciclo, então dois ciclos nunca
              // geram dois lançamentos no mesmo período.
              const invoice = await findOrCreateInvoice(
                tx,
                subscription.userId,
                bank.id,
                bank.invoiceDueDate,
                bank.invoiceDueDaysAfterClose,
                date,
              );

              if (invoice.status === 'PAID') {
                /**
                 * Fatura já conciliada: avança o marcador SEM lançar, senão o
                 * ciclo ficaria pendente para sempre e o cron tentaria todo dia.
                 *
                 * A fatura paga não é reaberta — o valor registrado como quitado
                 * tem de continuar sendo o que foi pago. O ciclo é descartado de
                 * forma deliberada e observável: volta como `skipped` com
                 * motivo, e o log registra a perda.
                 */
                const claimed = await tx.subscription.updateMany({
                  where: {
                    id: subscription.id,
                    lastGeneratedFor: markerBefore,
                  },
                  data: { lastGeneratedFor: formatCycle(cycle) },
                });
                if (claimed.count === 0) throw new CycleAlreadyClaimedError();

                this.logger.warn(
                  `Assinatura ${subscription.id}: ciclo ${formatCycle(cycle)} descartado — fatura já paga`,
                );

                return {
                  cycle: formatCycle(cycle),
                  date,
                  skipped: true,
                  skipReason: 'invoice-paid',
                };
              }

              invoiceId = invoice.id;
            }

            await tx.transaction.create({
              data: {
                userId: subscription.userId,
                subscriptionId: subscription.id,
                bankId: subscription.bankId,
                categoryId: subscription.categoryId,
                invoiceId,
                title: subscription.title,
                type: subscription.type,
                amount: subscription.amount,
                description: subscription.description,
                date,
              },
            });

            if (invoiceId) {
              await tx.invoice.update({
                where: { id: invoiceId, userId: subscription.userId },
                data: { totalAmount: { increment: subscription.amount } },
              });
            }

            // Mesma trava condicional: se outra execução já reivindicou este
            // ciclo, `count` é 0 e a transação inteira desfaz — inclusive o
            // lançamento e o incremento da fatura acima.
            const claimed = await tx.subscription.updateMany({
              where: { id: subscription.id, lastGeneratedFor: markerBefore },
              data: { lastGeneratedFor: formatCycle(cycle) },
            });
            if (claimed.count === 0) throw new CycleAlreadyClaimedError();

            return { cycle: formatCycle(cycle), date, skipped: false };
          },
        );
      } catch (error) {
        /**
         * Perder a corrida não é falha: significa que outra execução gerou
         * este ciclo. Interromper o laço é o correto — os ciclos seguintes
         * pertencem a quem venceu, e insistir daria lançamento duplicado.
         */
        if (error instanceof CycleAlreadyClaimedError) break;
        throw error;
      }

      plan.push(item);
      expectedMarker = formatCycle(cycle);
    }

    return plan;
  }
}
