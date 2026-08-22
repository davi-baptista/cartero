import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** Competência cuja renda se quer resolver. */
export class GetSalaryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;
}
