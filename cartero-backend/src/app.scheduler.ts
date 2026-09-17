import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from './prisma/prisma.service';
import { deriveStatusFromInvoiceDates } from './common/helpers/invoice.helper';

/**
 * `true` quando `now` cai na hora cheia em que a meia-noite de
 * `America/Fortaleza` acontece.
 *
 * Existe para separar duas coisas que o TZ6 misturou (TZ6.1): a hourly tick
 * (WHEN o job roda) da GATING POLICY do caminho legado (QUANDO ele tem
 * permissão de agir para `timeZone === null`). Comparar pela HORA (via
 * `Intl`, nunca offset fixo) em vez de comparar o dia civil inteiro é o que
 * torna a checagem robusta a qualquer deslocamento de :30/:45 que uma
 * timezone real possa ter (não é o caso de Fortaleza, mas a técnica não pode
 * depender disso).
 */
function isLegacyMidnightTick(now: Date): boolean {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Fortaleza',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return hour === '00';
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Candidate pruning — margem de segurança global (TZ6.2)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `closeDate`/`dueDate` são gravados como `YYYY-MM-DDT03:00:00Z` (âncora de
 * `dateForDayUtc`, `invoice.helper.ts`). Cada conta compara esse instante
 * contra o SEU PRÓPRIO dia civil (`timeZone === null` → UTC; `timeZone`
 * setado → `financialCivilDay` da conta). Como `User.timeZone` aceita
 * QUALQUER IANA reconhecido pelo runtime (`resolveIanaTimeZone`, TZ1 — sem
 * allowlist restrita), o pruning precisa ser seguro para todo o intervalo
 * físico de offsets IANA (UTC-12 a UTC+14), não só para as timezones
 * exercitadas nos testes.
 *
 * Medido contra as 417 zonas de `Intl.supportedValuesOf('timeZone')`, para a
 * âncora `03:00Z`: nenhuma zona alcança o dia civil do `dueDate`/`closeDate`
 * mais de 17h ANTES do instante gravado (o extremo mais adiantado testado,
 * `Etc/GMT+12`/`Pacific/Kiritimati`, UTC+14), e nenhuma zona ainda está
 * atrás mais de 9h DEPOIS dele (o extremo mais atrasado, UTC-12). A margem
 * usada aqui (18h/10h) arredonda esses limites medidos para cima —
 * intencionalmente, como cinto de segurança sobre a medição.
 *
 * Só EXCLUI candidatos cujo `dueDate` está tão longe no futuro que NENHUMA
 * timezone real poderia tê-lo alcançado ainda. Nunca poda pelo passado —
 * catch-up de faturas atrasadas (scheduler fora do ar por dias/semanas)
 * nunca é afetado, porque a condição só compara contra o futuro.
 */
export const CANDIDATE_PRUNING_SAFETY_MARGIN_MS = 18 * 60 * 60 * 1000;

export function candidatePruningCutoff(now: Date): Date {
  return new Date(now.getTime() + CANDIDATE_PRUNING_SAFETY_MARGIN_MS);
}

@Injectable()
export class AppScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(AppScheduler.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Bootstrap sempre roda imediatamente, em qualquer hora — comportamento
   * pré-TZ6 preservado (TZ6.1 §5): nunca foi gated à meia-noite, e não passa
   * a ser agora. `legacyGate: false` processa TODA conta, inclusive
   * `timeZone === null`, no boot.
   */
  async onApplicationBootstrap() {
    await this.syncInvoiceStatus({ legacyGate: false });
  }

  /**
   * TZ6: hourly, não mais 1x/dia — para contas com `User.timeZone`
   * configurado. TZ6.1: para `timeZone === null`, o TIMING de observação
   * histórico (1x/dia, à meia-noite de Fortaleza) precisa ser preservado —
   * só a DERIVAÇÃO de status sempre foi UTC, nunca a frequência com que o
   * scheduler tinha permissão de agir sobre ela.
   *
   * ── A regressão que isto corrige ──
   *
   * O cron diário só voltava a rodar 24h depois de cada disparo. Uma conta
   * legacy null cujo dia civil UTC virasse às 00:00 UTC (21h em Fortaleza)
   * só via o status persistido mudar na próxima meia-noite de Fortaleza
   * (~03:00 UTC) — uma janela de até 3h em que o UTC já indicava outro
   * status, mas nada era escrito. Rodar hourly SEM esse gate faria o
   * scheduler escrever nessa janela, ~3h mais cedo do que qualquer execução
   * histórica jamais escreveu — uma mudança de comportamento observável
   * para contas que nunca configuraram timezone.
   *
   * `legacyGate: true` (default, usado pelo próprio `@Cron`) restringe as
   * linhas `timeZone === null` ao tick que corresponde à meia-noite de
   * Fortaleza — a MESMA janela em que o cron diário sempre rodou. Contas
   * com timezone configurada continuam sendo processadas em TODO tick,
   * exatamente como o TZ6 estabeleceu.
   */
  @Cron(CronExpression.EVERY_HOUR, {
    timeZone: 'America/Fortaleza',
  })
  async syncInvoiceStatus(options: { legacyGate: boolean } = { legacyGate: true }) {
    this.logger.log('Verificando status de faturas...');

    const now = new Date();
    const legacyAllowedNow = !options.legacyGate || isLegacyMidnightTick(now);

    /*
      PAID é estado manual e final: o cron nunca o atribui nem o revoga —
      por isso nem entra no `where`.

      Sem `include: { bank: true }`: o status sai das datas que a própria
      fatura guarda. Carregar o banco era o que permitia a uma reconfiguração
      do cartão alterar o calendário de faturas históricas durante o cron —
      um sync reescrevia o passado sem ninguém pedir.

      `user: { select: { timeZone: true } }` entra no MESMO select — Prisma
      resolve com um JOIN, não uma query por fatura. `userId` já existia na
      linha; só a leitura da timezone do dono é nova, e vem de graça.

      ── Candidate pruning (TZ6.2) ──

      OPEN transiciona no `closeDate`; CLOSED transiciona no `dueDate`. Usar
      só `dueDate` como corte para as duas (como uma primeira versão desta
      mudança fazia) é um FALSO NEGATIVO real: uma fatura OPEN cujo
      `closeDate` já passou mas `dueDate` ainda está longe no futuro (ex.:
      intervalo de 10 dias entre fechamento e vencimento) seria podada antes
      de nunca ter sido promovida a CLOSED. Por isso o corte é condicional ao
      PRÓPRIO status da linha — `OR` de dois ramos, nunca um único campo:
        OPEN   → poda por `closeDate`
        CLOSED → poda por `dueDate`
      Cada ramo só EXCLUI quando aquele é o status real da linha (`AND
      status`), então o `OR` nunca inclui uma linha por engano sob o ramo
      errado.
    */
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: { in: ['OPEN', 'CLOSED'] },
        OR: [
          { status: 'OPEN', closeDate: { lte: candidatePruningCutoff(now) } },
          { status: 'CLOSED', dueDate: { lte: candidatePruningCutoff(now) } },
        ],
      },
      select: {
        id: true,
        status: true,
        closeDate: true,
        dueDate: true,
        user: { select: { timeZone: true } },
      },
    });

    for (const invoice of invoices) {
      const timeZone = invoice.user.timeZone;

      // Legacy null só age no tick correspondente à meia-noite histórica de
      // Fortaleza — preserva o TIMING de observação exato do cron diário,
      // sem reintroduzir um cron separado por timezone. Contas com
      // timezone configurada nunca passam por este gate.
      if (timeZone === null && !legacyAllowedNow) continue;

      // O status correto vem do calendário, em uma única decisão. Aplicar as
      // transições em sequência (OPEN→CLOSED, depois CLOSED→OVERDUE) fazia a
      // segunda condição ler o status carregado do banco, e não o recém
      // gravado: uma fatura ainda OPEN cujo vencimento já passou avançava só
      // até CLOSED, e só ficaria OVERDUE na execução seguinte. Isso aparecia
      // sempre que o scheduler ficava um tempo indisponível.
      const status = deriveStatusFromInvoiceDates(invoice, now, timeZone);

      if (status !== invoice.status) {
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: { status },
        });
      }
    }
  }
}
