import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

export class UnlinkTransactionDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  expectedEligibleIds?: string[];

  @IsOptional()
  @IsUUID('4')
  expectedPersonId?: string;
}
