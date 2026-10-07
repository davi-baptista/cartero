import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateRecurringExpenseDto {
  @IsString() @MaxLength(120) title: string;
  @IsNumber() @Min(0.01) amount: number;
  @IsInt() @Min(1) @Max(31) dayOfMonth: number;
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) firstOccurrence: string;
  @IsOptional() @IsString() @MaxLength(120) creditorName?: string;
  @IsOptional() @IsUUID() personId?: string;
}
