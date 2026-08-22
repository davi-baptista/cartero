import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Precisa dos decorators para sobreviver ao `whitelist: true` do
 * ValidationPipe — sem eles o PATCH chegaria vazio ao serviço. Espelha
 * `CreateCategoryDto`, com tudo opcional.
 */
export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  color?: string;
}
