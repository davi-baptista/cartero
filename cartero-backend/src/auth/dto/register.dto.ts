import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @MinLength(1)
  name: string;

  /** Timezone financeira obrigatÃ³ria para toda conta nova. */
  @IsString()
  @MinLength(1)
  timeZone: string;
}
