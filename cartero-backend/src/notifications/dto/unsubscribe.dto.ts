import { IsString } from 'class-validator';

export class UnsubscribeDto {
  @IsString()
  endpoint: string;
}
