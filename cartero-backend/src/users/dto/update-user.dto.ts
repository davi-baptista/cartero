import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  /*
    `salary` NÃO é editável aqui.

    A renda tem competência: escrever `User.salary` direto gravaria o cache
    sem criar a entrada correspondente em `SalaryHistory`, e o resolver
    passaria a discordar do valor exibido no perfil. Use `PUT /salary`, que
    grava a competência e sincroniza o cache.

    Removido do DTO em vez de apenas ignorado: com `whitelist: true` o campo
    seria descartado em silêncio, e um cliente antigo acharia que salvou.
  */

  @IsOptional()
  @IsBoolean()
  createIncomeOnReceivablePaid?: boolean;

  @IsOptional()
  @IsBoolean()
  createExpenseOnDebtPaid?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  notifyDaysBefore?: number;
}
