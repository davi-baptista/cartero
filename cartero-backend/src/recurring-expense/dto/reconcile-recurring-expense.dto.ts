import { IsInt, Max, Min } from 'class-validator';

export class ReconcileRecurringExpenseDto {
  @IsInt() @Min(1) @Max(12) month: number;
  @IsInt() @Min(1900) @Max(9999) year: number;
}
