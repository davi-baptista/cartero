import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

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

  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  installments?: number;
}
