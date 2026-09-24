import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsString, Matches, Max, Min } from 'class-validator';

export class PreviewRecurringIncomeDto {
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  firstOccurrence: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth: number;
}
