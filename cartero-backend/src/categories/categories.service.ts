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

    await this.prisma.category.delete({
      where: { id, userId },
    });

    return;
  }
}
