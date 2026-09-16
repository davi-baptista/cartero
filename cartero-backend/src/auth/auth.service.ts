import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { hash, compare } from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { EnvService } from 'src/env/env.service';
import {
  TOKEN_USE,
  canMintSession,
  type CarteroJwtPayload,
} from './token-purpose';
import { resolveIanaTimeZone } from 'src/common/helpers/timezone.helper';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private env: EnvService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email já registrado');
    }

    /*
      Rejeita explicitamente em vez de descartar em silêncio: um client que
      envie algo inválido (ex.: um offset por engano) precisa saber que não
      foi persistido, não achar que salvou. Ausente (`undefined`) é o caminho
      normal — vira `timeZone: null`, igual a uma conta legada (TZ1: nenhuma
      feature financeira ainda lê este campo).

      `resolveIanaTimeZone` faz validate+canonicalize num só passo — o valor
      gravado é sempre o CANÔNICO devolvido pelo runtime, nunca o input cru
      (TZ1.0.1: `AuthService.register` chegou a persistir o raw input já
      validado, sem nunca canonicalizar).
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

    const hashed = await hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
        name: dto.name,
        timeZone,
      },
    });

    const tokens = this.generateToken(user.id);
    const { password: _pwd, ...userWithoutPassword } = user;
    return { ...tokens, user: userWithoutPassword };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user || !(await compare(dto.password, user.password))) {
      throw new UnauthorizedException('Credenciais ínvalidas');
    }

    const tokens = this.generateToken(user.id);
    const { password: _pwd, ...userWithoutPassword } = user;
    return { ...tokens, user: userWithoutPassword };
  }

  async refresh(refreshToken: string) {
    let payload: CarteroJwtPayload;

    try {
      payload = this.jwt.verify<CarteroJwtPayload>(refreshToken, {
        secret: this.env.get('REFRESH_TOKEN_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Credenciais ínvalidas');
    }

    /*
      A assinatura confere — mas assinatura prova ORIGEM, não FINALIDADE.

      `JWT_SECRET` e `REFRESH_TOKEN_SECRET` são variáveis distintas que o
      `.env.example` do projeto instrui a preencher com o mesmo valor. Com a
      chave coincidindo, um access token de 15 minutos passava nesta
      verificação e saía daqui convertido num refresh de 30 dias.

      O 401 é deliberado, não 400: o token é criptograficamente válido, só
      não serve para esta finalidade. É o mesmo status de um refresh
      expirado, que é o que o cliente móvel já trata como rejeição
      definitiva.
    */
    if (!canMintSession(payload)) {
      throw new UnauthorizedException('Credenciais ínvalidas');
    }

    return this.generateToken(payload.sub);
  }

  /*
    Todo token emitido declara para que serve, e a declaração viaja dentro da
    assinatura — não pode ser alterada sem a chave.
  */
  private generateToken(userId: string) {
    return {
      access_token: this.jwt.sign({
        sub: userId,
        tokenUse: TOKEN_USE.access,
      }),
      refresh_token: this.jwt.sign(
        { sub: userId, tokenUse: TOKEN_USE.refresh },
        {
          secret: this.env.get('REFRESH_TOKEN_SECRET'),
          expiresIn: '30d',
        },
      ),
    };
  }
}
