import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdatePersonDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;
}
