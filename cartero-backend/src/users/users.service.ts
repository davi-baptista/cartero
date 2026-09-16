import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { hash } from 'bcrypt';
import { resolveIanaTimeZone } from 'src/common/helpers/timezone.helper';

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
    /*
      Mesma postura do cadastro (TZ1): rejeita explicitamente em vez de
      descartar em silêncio. Ausente (`undefined`) não toca o campo — não
      confundir com `null`, que este DTO não aceita.

      `resolveIanaTimeZone` faz validate+canonicalize num só passo — o valor
      gravado é sempre o CANÔNICO devolvido pelo runtime, nunca o input cru
      (TZ1.0.1).
    */
    let timeZone: string | undefined;
    if (dto.timeZone !== undefined) {
      const resolved = resolveIanaTimeZone(dto.timeZone);
      if (resolved === null) {
        throw new BadRequestException({
          message: 'Timezone inválida.',
          code: 'INVALID_TIME_ZONE',
        });
      }
      timeZone = resolved;
    }

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
        timeZone,
        password: dto.password ? await hash(dto.password, 10) : undefined,
      },
    });

    const { password: _pwd, ...UserWithoutPassword } = user;
    return UserWithoutPassword;
  }
}
