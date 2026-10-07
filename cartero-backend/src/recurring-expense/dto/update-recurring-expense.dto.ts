import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateRecurringExpenseDto {
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsNumber() @Min(0.01) amount?: number;
  @IsOptional() @IsInt() @Min(1) @Max(31) dayOfMonth?: number;
  @IsOptional() @IsString() @MaxLength(120) creditorName?: string | null;
  @IsOptional() @IsUUID() personId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
