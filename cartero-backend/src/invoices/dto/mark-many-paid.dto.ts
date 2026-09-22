import { ArrayMaxSize, IsArray, IsDateString, IsOptional, IsUUID } from 'class-validator';

export class MarkManyPaidDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  ids: string[];

  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsUUID('4')
  bankId?: string;
}
