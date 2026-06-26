import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { hash } from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const { password: _pwd, ...UserWithoutPassword } = user;
    return UserWithoutPassword;
  }

  async update(id: string, dto: UpdateUserDto) {
    const data = dto.password
      ? { ...dto, password: await hash(dto.password, 10) }
      : { ...dto };

    const user = await this.prisma.user.update({
      where: { id },
      data,
    });

    const { password: _pwd, ...UserWithoutPassword } = user;
    return UserWithoutPassword;
  }
}
