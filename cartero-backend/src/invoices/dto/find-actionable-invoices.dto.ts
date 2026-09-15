import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  ACTIONABLE_INVOICES_DEFAULT_LIMIT,
  ACTIONABLE_INVOICES_MAX_LIMIT,
} from 'src/common/helpers/actionable-invoices.helper';

/**
 * `limit` malformado (0, negativo, não-inteiro, acima do máximo) é rejeitado
 * pelo `ValidationPipe` global — não é silenciosamente clampado. Um cliente
 * que pedir `limit=999` deve saber que pediu errado, não receber 10 faturas
 * calado.
 */
export class FindActionableInvoicesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ACTIONABLE_INVOICES_MAX_LIMIT)
  limit: number = ACTIONABLE_INVOICES_DEFAULT_LIMIT;
}
