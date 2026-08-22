import { TransactionType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsUUID, Matches, Max, Min } from 'class-validator';

/**
 * Parâmetros da simulação de geração.
 *
 * Era o único endpoint do módulo sem validação, e as duas lacunas eram
 * visíveis: `startedAt` malformado chegava a `parseCycle`, que lança `Error`
 * cru e virava 500 em vez de 400; `dayOfMonth` não numérico virava `NaN`,
 * produzindo datas inválidas serializadas como `null`, sem erro nenhum.
 */
export class PreviewSubscriptionDto {
  @IsUUID()
  bankId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth: number;

  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'startedAt deve estar no formato YYYY-MM',
  })
  startedAt: string;

  @IsEnum(TransactionType)
  type: TransactionType;
}
