import { IsString, MinLength } from 'class-validator';

export class CreatePersonDto {
  @IsString()
  @MinLength(1)
  name: string;
}
