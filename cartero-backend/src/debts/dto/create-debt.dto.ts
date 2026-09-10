import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  MAX_INSTALLMENTS,
  MAX_INSTALLMENTS_MESSAGE,
} from 'src/common/constants/installments';

export class CreateDebtDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  creditorName?: string;

  @IsOptional()
  @IsUUID()
  personId?: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  occurredAt: string;

  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsBoolean()
  isAlertEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_INSTALLMENTS, { message: MAX_INSTALLMENTS_MESSAGE })
  installments?: number;
}
