import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @MinLength(1)
  name: string;

  /**
   * Timezone financeira detectada pelo cliente no momento do cadastro (TZ1).
   *
   * Validação estrutural aqui (é uma string); a validação semântica de IANA
   * (`isValidIanaTimeZone`) acontece no service, que é onde a mensagem de
   * erro de negócio já vive para os demais campos deste fluxo.
   *
   * Opcional de propósito: um cliente antigo que não conhece este campo, ou
   * um runtime que falhe a detecção, continua criando conta normalmente —
   * o resultado é `timeZone: null`, a mesma situação de uma conta legada.
   */
  @IsOptional()
  @IsString()
  timeZone?: string;
}
