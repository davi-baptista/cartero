import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  currentCompetence,
  resolveSalaryForMonth,
  type ResolvedSalary,
  type SalaryCompetence,
} from 'src/common/helpers/salary.helper';
import { UpsertSalaryDto } from './dto/upsert-salary.dto';

@Injectable()
export class SalaryService {
  constructor(private prisma: PrismaService) {}

  /** Renda aplicável a uma competência. */
  async resolve(
    userId: string,
    competence: SalaryCompetence,
  ): Promise<ResolvedSalary> {
    return await resolveSalaryForMonth(
      this.prisma as unknown as Prisma.TransactionClient,
      userId,
      competence,
    );
  }

  /**
   * Define a renda a partir de uma competência.
   *
   * Idempotente pelo unique `(userId, year, month)`: definir "ago/2026 = 5000"
   * duas vezes atualiza a mesma linha em vez de duplicar.
   *
   * NÃO toca em entradas posteriores. Registrar "jan = 4000" quando já existe
   * "abr = 4500" faz jan–mar valerem 4000 e abril continuar 4500 — cada
   * entrada é uma alteração pontual, não um valor retroativo global.
   */
  async upsert(userId: string, dto: UpsertSalaryDto) {
    const competence = { year: dto.year, month: dto.month };

    const entry = await this.prisma.salaryHistory.upsert({
      where: {
        userId_year_month: {
          userId,
          year: dto.year,
          month: dto.month,
        },
      },
      create: {
        userId,
        year: dto.year,
        month: dto.month,
        amount: dto.amount,
      },
      update: { amount: dto.amount },
    });

    await this.syncCurrentSalaryCache(userId);

    return {
      amount: Number(entry.amount),
      effectiveFrom: competence,
      /** A renda que passa a valer HOJE depois desta alteração. */
      currentSalary: await this.resolve(userId, currentCompetence()),
    };
  }

  /**
   * Mantém `User.salary` alinhado à renda do mês CORRENTE.
   *
   * O campo é cache de leitura para telas sem mês (perfil, cabeçalhos). Ele é
   * recalculado a partir do histórico, não copiado do valor que acabou de ser
   * gravado: corrigir um mês passado ou agendar um aumento futuro não deve
   * mudar a renda exibida hoje.
   *
   * Exemplo: histórico tem ago=5000; o usuário cadastra out=5500. O cache
   * continua 5000, porque em outubro o resolver já devolverá 5500 sozinho.
   */
  private async syncCurrentSalaryCache(userId: string): Promise<void> {
    const current = await this.resolve(userId, currentCompetence());

    await this.prisma.user.update({
      where: { id: userId },
      data: { salary: current.known ? current.amount : null },
    });
  }
}
