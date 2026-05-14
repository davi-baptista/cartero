import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateReceivableDto {
  @IsString()
  title: string;

  @IsString()
  debtorName: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  installments?: number;
}
