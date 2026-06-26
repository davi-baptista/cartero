import {
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

    const hashed = await hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
        name: dto.name,
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
    try {
      const payload = this.jwt.verify(refreshToken, {
        secret: this.env.get('REFRESH_TOKEN_SECRET'),
      });
      return this.generateToken(payload.sub);
    } catch {
      throw new UnauthorizedException('Credenciais ínvalidas');
    }
  }

  private generateToken(userId: string) {
    return {
      access_token: this.jwt.sign({ sub: userId }),
      refresh_token: this.jwt.sign(
        { sub: userId },
        {
          secret: this.env.get('REFRESH_TOKEN_SECRET'),
          expiresIn: '30d',
        },
      ),
    };
  }
}
