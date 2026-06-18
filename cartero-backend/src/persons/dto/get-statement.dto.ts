import { IsDateString, IsOptional } from 'class-validator';

export class GetStatementDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
