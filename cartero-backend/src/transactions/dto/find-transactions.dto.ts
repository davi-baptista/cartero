import { TransactionType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

export class FindTransactionsDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  /**
   * When enabled, credit-card transactions are filtered by their invoice
   * month/year instead of their original purchase date. Non-card transactions
   * continue using their transaction date.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  invoicePeriod?: boolean;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  bankId?: string;

  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;
}
