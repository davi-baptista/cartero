import { IsOptional, IsString } from 'class-validator';

export class FindPersonsDto {
  @IsOptional()
  @IsString()
  name?: string;
}
