import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { EntityValidationService } from 'src/common/entity-validation.service';
import { SYSTEM_CATEGORY_NAMES } from 'src/common/constants/system-categories';

@Injectable()
export class CategoriesService {
  constructor(
    private prisma: PrismaService,
    private entityValidationService: EntityValidationService,
  ) {}

  async create(userId: string, dto: CreateCategoryDto) {
    if (SYSTEM_CATEGORY_NAMES.includes(dto.name)) {
      throw new BadRequestException(
        'Esse nome é reservado para uma categoria do sistema',
      );
    }

    const existing = await this.prisma.category.findFirst({
      where: { userId, name: dto.name },
    });

    if (existing) {
      throw new ConflictException('Categoria já existe');
    }

    return await this.prisma.category.create({
      data: {
        userId,
        name: dto.name,
        color: dto.color,
        icon: dto.icon,
      },
    });
  }

  async findOne(id: string, userId: string) {
    return await this.entityValidationService.validateCategory(id, userId);
  }

  async findAll(userId: string) {
    return await this.prisma.category.findMany({
      where: { userId },
    });
  }

  async update(id: string, userId: string, dto: UpdateCategoryDto) {
    const existing = await this.entityValidationService.validateCategory(
      id,
      userId,
    );

    if (existing.isSystem) {
      throw new ForbiddenException(
        'Categorias do sistema não podem ser editadas',
      );
    }

    if (dto.name && SYSTEM_CATEGORY_NAMES.includes(dto.name)) {
      throw new BadRequestException(
        'Esse nome é reservado para uma categoria do sistema',
      );
    }

    return await this.prisma.category.update({
      where: { id, userId },
      data: dto,
    });
  }

  /**
   * Categoria em uso não é excluível.
   *
   * A FK de `Transaction.categoryId` é `ON DELETE RESTRICT` e o campo é
   * obrigatório, então o banco já recusava a exclusão — mas com um erro cru do
   * Prisma, que virava 500 e chegava ao usuário como "Erro ao excluir
   * categoria", sem dizer o motivo. Aqui a recusa vira um conflito de domínio
   * com a contagem do que impede, para a tela poder explicar.
   *
   * Assinaturas entram na verificação porque `Subscription.categoryId` também
   * é obrigatório: apagar a categoria quebraria a regra recorrente.
   */
  async remove(id: string, userId: string) {
    const existing = await this.entityValidationService.validateCategory(
      id,
      userId,
    );

    if (existing.isSystem) {
      throw new ForbiddenException(
        'Categorias do sistema não podem ser excluídas',
      );
    }

    const [transactions, subscriptions] = await Promise.all([
      this.prisma.transaction.count({ where: { categoryId: id, userId } }),
      this.prisma.subscription.count({ where: { categoryId: id, userId } }),
    ]);

    if (transactions > 0 || subscriptions > 0) {
      throw new ConflictException({
        message: this.buildInUseMessage(transactions, subscriptions),
        code: 'CATEGORY_IN_USE',
        details: { transactions, subscriptions },
      });
    }

    await this.prisma.category.delete({
      where: { id, userId },
    });

    return;
  }

  /** Menciona só o que de fato existe, no singular ou plural correto. */
  private buildInUseMessage(
    transactions: number,
    subscriptions: number,
  ): string {
    const parts: string[] = [];
    if (transactions > 0) {
      parts.push(
        transactions === 1 ? '1 transação' : `${transactions} transações`,
      );
    }
    if (subscriptions > 0) {
      parts.push(
        subscriptions === 1 ? '1 assinatura' : `${subscriptions} assinaturas`,
      );
    }

    return `Esta categoria está sendo usada em ${parts.join(' e ')} e não pode ser excluída.`;
  }
}
