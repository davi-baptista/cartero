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
    // Campos explícitos: `email` e `id` não estão no DTO e não podem passar a
    // estar por acidente — espalhar o corpo da requisição aqui permitiria
    // trocar a identidade da conta.
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name,
        createIncomeOnReceivablePaid: dto.createIncomeOnReceivablePaid,
        createExpenseOnDebtPaid: dto.createExpenseOnDebtPaid,
        notifyDaysBefore: dto.notifyDaysBefore,
        password: dto.password ? await hash(dto.password, 10) : undefined,
      },
    });

    const { password: _pwd, ...UserWithoutPassword } = user;
    return UserWithoutPassword;
  }
}
