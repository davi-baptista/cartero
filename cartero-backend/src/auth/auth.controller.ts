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
