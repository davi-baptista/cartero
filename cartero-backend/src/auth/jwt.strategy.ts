import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { EnvService } from 'src/env/env.service';
import { canAuthenticateRequest, type CarteroJwtPayload } from './token-purpose';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private envService: EnvService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: envService.get('JWT_SECRET'),
    });
  }

  validate(payload: CarteroJwtPayload) {
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

    return { id: payload.sub };
  }
}
