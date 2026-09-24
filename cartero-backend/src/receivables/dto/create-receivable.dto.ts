import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { IncomeClassification } from '@prisma/client';
import {
  MAX_INSTALLMENTS,
  MAX_INSTALLMENTS_MESSAGE,
} from 'src/common/constants/installments';

export class CreateReceivableDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  debtorName?: string;

  @IsOptional()
  @IsUUID()
  personId?: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(IncomeClassification)
  incomeClassification?: IncomeClassification;

  @IsDateString()
  occurredAt: string;

  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_INSTALLMENTS, { message: MAX_INSTALLMENTS_MESSAGE })
  installments?: number;
}
