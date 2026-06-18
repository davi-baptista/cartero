import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class FindReceivablesDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsUUID()
  personId?: string;

  @IsOptional()
  @IsString()
  debtorName?: string;
}
