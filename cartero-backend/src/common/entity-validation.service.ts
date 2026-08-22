import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class EntityValidationService {
  constructor(private prisma: PrismaService) {}

  async validateTransaction(transactionId: string, userId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId, userId },
    });

    if (!transaction) {
      throw new NotFoundException('Transação não encontrada');
    }

    return transaction;
  }

  /**
   * Banco do usuário, recusando por padrão contas arquivadas.
   *
   * O padrão é o caso perigoso — criar movimentação — porque um fluxo novo que
   * esqueça de checar `isArchived` falha fechado, não aberto. Os poucos
   * caminhos que só LEEM a configuração de fatura (restaurar o banco, derivar
   * o vencimento de uma transação que já existe) pedem `allowArchived` de
   * forma explícita, e a exceção fica visível na chamada.
   *
   * Não substitui as guardas de PAID/CLOSED/recebível pago: arquivamento diz
   * "não use para movimento novo", não "este registro está congelado".
   */
  async validateBank(
    bankId: string,
    userId: string,
    options: { allowArchived?: boolean } = {},
  ) {
    const bank = await this.prisma.bank.findUnique({
      where: {
        id: bankId,
        userId,
      },
    });

    if (!bank) {
      throw new NotFoundException('Banco não encontrado');
    }

    if (bank.isArchived && !options.allowArchived) {
      throw new ConflictException({
        message: `${bank.name} está arquivado e não aceita novos lançamentos. Restaure o banco para voltar a usá-lo.`,
        code: 'BANK_ARCHIVED',
      });
    }

    return bank;
  }

  async validateCategory(categoryId: string, userId: string) {
    const category = await this.prisma.category.findUnique({
      where: {
        id: categoryId,
        userId,
      },
    });

    if (!category) {
      throw new NotFoundException('Categoria não encontrada');
    }

    return category;
  }

  async validateInvoice(invoiceId: string, userId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: {
        id: invoiceId,
        userId,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Fatura não encontrada');
    }

    return invoice;
  }

  async validateDebt(debtId: string, userId: string) {
    const debt = await this.prisma.debt.findUnique({
      where: {
        id: debtId,
        userId,
      },
    });

    if (!debt) {
      throw new NotFoundException('Dívida não encontrada');
    }

    return debt;
  }

  async validateReceivable(receivableId: string, userId: string) {
    const receivable = await this.prisma.receivable.findUnique({
      where: {
        id: receivableId,
        userId,
      },
    });

    if (!receivable) {
      throw new NotFoundException('Recebível não encontrado');
    }

    return receivable;
  }

  async validatePerson(personId: string, userId: string) {
    const person = await this.prisma.person.findUnique({
      where: {
        id: personId,
        userId,
      },
    });

    if (!person) {
      throw new NotFoundException('Pessoa não encontrada');
    }

    return person;
  }

  /**
   * A categoria de sistema com este nome, criando-a se ainda não existir.
   *
   * Usada por cinco fluxos que precisam classificar um lançamento automático:
   * "Dívida paga" (pagar dívida e settle de pessoa), "Receita recebida"
   * (receber recebível e settle) e "Assinatura" (criar/editar assinatura).
   *
   * ─── Categoria própria com nome homônimo ─────────────────────────────────
   *
   * A busca é só por nome porque a unicidade é `(userId, name)`: filtrar por
   * `isSystem` deixaria passar uma categoria que o usuário já criou com esse
   * nome, e o create seguinte violaria a constraint.
   *
   * Encontrando uma categoria PRÓPRIA homônima, ela é REUTILIZADA como está —
   * sem promoção. A versão anterior a convertia em categoria de sistema
   * (`isSystem: true`, com ícone e cor sobrescritos), e isso era um efeito
   * colateral que ninguém pediu: bastava criar uma assinatura para uma
   * categoria chamada "Assinatura" deixar de ser editável e excluível, sem
   * caminho de volta pela interface.
   *
   * Reutilizar sem promover atende os dois lados. Os lançamentos automáticos
   * ficam classificados no lugar que o usuário já escolheu para eles, e a
   * categoria continua sendo dele — editável, renomeável, excluível quando
   * não estiver em uso.
   *
   * Categorias que JÁ estão marcadas como sistema permanecem como estão. Não
   * há como saber se foram criadas assim ou adotadas indevidamente antes desta
   * correção, e sem essa evidência despromover seria adivinhar.
   */
  async findOrCreateSystemCategory(
    tx: Prisma.TransactionClient,
    userId: string,
    name: string,
    icon: string,
    color: string,
  ) {
    const existing = await tx.category.findFirst({ where: { userId, name } });

    // Serve tanto para a de sistema quanto para uma própria homônima: em
    // nenhum dos dois casos algo é alterado.
    if (existing) return existing;

    return tx.category.create({
      data: { userId, name, icon, color, isSystem: true },
    });
  }
}
