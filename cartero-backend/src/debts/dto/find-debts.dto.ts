import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class FindDebtsDto {
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
  creditorName?: string;
}
