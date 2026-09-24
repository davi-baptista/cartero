import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateRecurringIncomeDto {
  @IsString()
  @MaxLength(120)
  title: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth: number;

  /** Competência inicial explícita; omitida usa a próxima ocorrência civil. */
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'firstOccurrence deve estar no formato YYYY-MM',
  })
  firstOccurrence: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  counterpartyName?: string;
}
