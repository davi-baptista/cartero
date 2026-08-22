import { Injectable, NotFoundException } from '@nestjs/common';
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
   * Histórico real, do mais recente para o mais antigo.
   *
   * Devolve SOMENTE as entradas cadastradas. Meses sem entrada são resolvidos
   * por herança e não existem como registro — materializá-los aqui criaria a
   * ilusão de que cada mês tem um valor próprio, e a edição de um deles
   * passaria a significar algo que o modelo não suporta.
   */
  async list(userId: string) {
    const entries = await this.prisma.salaryHistory.findMany({
      where: { userId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: { id: true, year: true, month: true, amount: true },
    });

    return entries.map((entry) => ({
      id: entry.id,
      year: entry.year,
      month: entry.month,
      amount: Number(entry.amount),
    }));
  }

  /**
   * Corrige o VALOR de uma competência já cadastrada.
   *
   * Separado do `upsert` de propósito: aqui a ausência é erro, não convite a
   * criar. Editar "janeiro" com um mês digitado errado deve falhar em vez de
   * cadastrar silenciosamente uma competência nova que ninguém pediu — e que
   * mudaria a renda resolvida de todos os meses seguintes.
   *
   * A competência em si é imutável nesta operação: transformar janeiro em
   * fevereiro é outra intenção (mover uma alteração no tempo), com outros
   * efeitos sobre a herança, e não é o que "corrigir o valor" significa.
   */
  async updateAmount(
    userId: string,
    competence: SalaryCompetence,
    amount: number,
  ) {
    /*
      `updateMany` com `userId` no `where` resolve ownership e existência numa
      só ida ao banco: sem a linha do dono, `count` é 0 e nada foi tocado.

      Um `findFirst` seguido de `update` por id abriria janela entre a checagem
      e a escrita, além de uma segunda consulta.
    */
    const { count } = await this.prisma.salaryHistory.updateMany({
      where: {
        userId,
        year: competence.year,
        month: competence.month,
      },
      data: { amount },
    });

    if (count === 0) {
      throw new NotFoundException({
        code: 'SALARY_ENTRY_NOT_FOUND',
        message: 'Não existe registro de renda para esta competência.',
      });
    }

    await this.syncCurrentSalaryCache(userId);

    return {
      year: competence.year,
      month: competence.month,
      amount,
      /** A renda que passa a valer HOJE depois da correção. */
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
