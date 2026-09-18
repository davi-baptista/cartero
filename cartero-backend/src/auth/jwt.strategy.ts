import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { EnvService } from 'src/env/env.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { canAuthenticateRequest, type CarteroJwtPayload } from './token-purpose';
import type { AuthenticatedUser } from './authenticated-user';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private envService: EnvService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: envService.get('JWT_SECRET'),
    });
  }

  async validate(payload: CarteroJwtPayload): Promise<AuthenticatedUser> {
    /*
      Assinatura e validade não bastam.

      Esta estratégia verificava apenas isso — e como `JWT_SECRET` e
      `REFRESH_TOKEN_SECRET` carregam o mesmo valor (é o que o
      `.env.example` do projeto instrui), um refresh token apresentado como
      `Authorization: Bearer` autenticava qualquer rota protegida. Foi
      verificado contra o backend real: 200 em `/users/me`, `/banks` e
      `/categories`.

      Esse era o lado mais grave do problema. O refresh token vive 30 dias no
      Keychain do celular e no cookie do navegador; conceder a ele poder de
      API transforma uma credencial de longa duração, guardada para uma única
      finalidade, numa chave de uso geral.

      Rejeitar aqui produz 401, o mesmo status de um token expirado — que é
      exatamente o que o cliente já sabe tratar.
    */
    if (!canAuthenticateRequest(payload)) {
      throw new UnauthorizedException('Credenciais ínvalidas');
    }

    /*
      `timeZone` vem do BANCO, nunca do claim do JWT: é editável pelo usuário
      (`PATCH /users/me`) e um claim assinado ficaria stale até o token
      expirar. `@CurrentUser()` devolvia só `{ id: payload.sub }` — controllers
      que liam `user.timeZone` sempre recebiam `undefined`, para todo usuário,
      em toda request, independente do dado persistido (o crash não era
      "conta com timezone nula"; era a timezone nunca chegar aqui).

      Select estreito por primary key — uma leitura indexada por request,
      nada de N+1: nenhum outro campo é lido por nenhum controller a partir
      deste objeto (auditado — só `.id` e `.timeZone`).

      Com o schema hardening (`User.timeZone` `NOT NULL`), o Prisma tipa
      `user.timeZone` como `string` — `AuthenticatedUser` reflete essa
      garantia, e nenhum caller downstream precisa tratar `null`.
    */
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, timeZone: true },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciais ínvalidas');
    }

    return user;
  }
}
