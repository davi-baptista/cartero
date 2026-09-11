import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { MobileRefreshDto } from './dto/mobile-refresh.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { access_token, refresh_token, user } =
      await this.authService.register(dto);

    this.setRefreshCookie(res, refresh_token);

    return { accessToken: access_token, user };
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { access_token, refresh_token, user } =
      await this.authService.login(dto);

    this.setRefreshCookie(res, refresh_token);

    return { accessToken: access_token, user };
  }

  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies['refresh_token'];

    if (!refreshToken) {
      throw new UnauthorizedException('Credenciais ínvalidas');
    }

    const { access_token, refresh_token } =
      await this.authService.refresh(refreshToken);

    this.setRefreshCookie(res, refresh_token);

    return { accessToken: access_token };
  }

  /*
    ── Transporte NATIVO ──

    Rotas separadas, e a separação é ARQUITETURAL, não um header que qualquer
    cliente poderia enviar: é o CAMINHO que decide o transporte. A rota web
    continua sem devolver o refresh token ao JavaScript, então um XSS no
    browser segue sem alcançá-lo — o benefício do cookie `HttpOnly` fica
    intacto. Distinguir por `User-Agent` ou por um header `X-Client: mobile`
    seria teatro: ambos são triviais de forjar, e a rota web passaria a expor
    o token a quem pedisse.

    Nenhuma regra de credencial vive aqui. `AuthService.login` e
    `AuthService.refresh` são os mesmos das rotas web — duplicar a validação
    ou a assinatura do token criaria duas autoridades que divergiriam na
    primeira alteração de TTL ou de claim.
  */

  /** Login de cliente nativo: o refresh token vem no corpo, sem cookie. */
  @Post('mobile/login')
  async mobileLogin(@Body() dto: LoginDto) {
    const { access_token, refresh_token, user } =
      await this.authService.login(dto);

    return { accessToken: access_token, refreshToken: refresh_token, user };
  }

  /*
    Renovação nativa.

    O par novo SUBSTITUI o anterior no armazenamento seguro do app. Isso não é
    rotação com invalidação: a arquitetura é stateless e o token antigo segue
    válido até expirar. A revogação real depende de um modelo de sessão, que é
    RELEASE GATE antes de distribuir para terceiros — não uma promessa que
    esta rota possa fazer hoje.
  */
  @Post('mobile/refresh')
  async mobileRefresh(@Body() dto: MobileRefreshDto) {
    const { access_token, refresh_token } = await this.authService.refresh(
      dto.refreshToken,
    );

    return { accessToken: access_token, refreshToken: refresh_token };
  }

  @Post('logout')
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('refresh_token', this.refreshCookieOptions());
    return { message: 'Logout realizado com sucesso' };
  }

  private setRefreshCookie(res: Response, token: string) {
    res.cookie('refresh_token', token, {
      ...this.refreshCookieOptions(),
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias
    });
  }

  private refreshCookieOptions(): CookieOptions {
    const isProduction =
      process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
    };
  }
}
