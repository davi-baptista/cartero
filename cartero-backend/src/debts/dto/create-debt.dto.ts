import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

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
  dueDate: string;

  @IsOptional()
  @IsBoolean()
  isAlertEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  installments?: number;
}
