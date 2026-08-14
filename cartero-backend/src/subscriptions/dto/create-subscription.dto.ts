import { TransactionType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateSubscriptionDto {
  @IsString()
  title: string;

  @IsUUID()
  bankId: string;

  @IsUUID()
  categoryId: string;

  @IsEnum(TransactionType)
  type: TransactionType;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth: number;

  /** Primeiro ciclo coberto, "YYYY-MM". Imutável depois de criado. */
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'startedAt deve estar no formato YYYY-MM',
  })
  startedAt: string;
}
