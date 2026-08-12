import {
  IsBoolean,
  IsInt,
  IsNumber,
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

  @IsOptional()
  @IsNumber()
  @Min(0)
  salary?: number;

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
