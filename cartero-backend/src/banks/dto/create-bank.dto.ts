import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateBankDto {
  @IsString()
  name: string;

  // Kept optional for compatibility with older clients. New clients should
  // configure the interval instead of entering a fixed close day.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  invoiceCloseDate?: number;

  @IsInt()
  @Min(1)
  @Max(31)
  invoiceDueDate: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  invoiceDueDaysAfterClose?: number;
}
