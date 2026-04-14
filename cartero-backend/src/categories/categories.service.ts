import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { EntityValidationService } from 'src/common/entity-validation.service';

@Injectable()
export class CategoriesService {
  constructor(
    private prisma: PrismaService,
    private entityValidationService: EntityValidationService,
  ) {}

  async create(userId: string, dto: CreateCategoryDto) {
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
    await this.entityValidationService.validateCategory(id, userId);

    return await this.prisma.category.update({
      where: { id, userId },
      data: dto,
    });
  }

  async remove(id: string, userId: string) {
    await this.entityValidationService.validateCategory(id, userId);

    await this.prisma.category.delete({
      where: { id, userId },
    });

    return;
  }
}
