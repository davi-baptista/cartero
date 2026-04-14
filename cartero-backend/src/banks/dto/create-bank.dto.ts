import { IsInt, IsString, Max, Min } from 'class-validator';

export class CreateBankDto {
  @IsString()
  name: string;

  @IsInt()
  @Min(1)
  @Max(31)
  invoiceCloseDate: number;

  @IsInt()
  @Min(1)
  @Max(31)
  invoiceDueDate: number;
}
