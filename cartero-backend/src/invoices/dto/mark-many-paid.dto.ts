import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export class MarkManyPaidDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  ids: string[];
}
