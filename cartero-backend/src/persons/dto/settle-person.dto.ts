import { TransactionType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

export class SettlePersonDto {
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsUUID()
  paymentBankId?: string;

  @IsOptional()
  @IsEnum(TransactionType)
  paymentType?: TransactionType;
}
