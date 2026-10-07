import { TransactionType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MAX_PAGE_LIMIT } from 'src/common/pagination/pagination.constants';

export class FindTransactionsDto {
  /** Cursor pagination is opt-in so existing callers keep the array response. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  /** Named type group used by contextual navigation from the overview. */
  @IsOptional()
  @IsIn(['direct'])
  group?: 'direct';

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

  /** Return only child rows from an installment series. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  installmentsOnly?: boolean;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  bankId?: string;

  @IsOptional()
  @IsUUID()
  subscriptionId?: string;

  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;
}
