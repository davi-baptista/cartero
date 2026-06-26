import { Type } from 'class-transformer';
import { IsOptional, IsInt, IsUUID, Min, Max } from 'class-validator';

export class FindInvoicesDto {
  @IsOptional()
  @IsUUID()
  bankId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  year?: number;
}
