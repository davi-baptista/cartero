import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/**
 * Competência da visão mensal de Pessoas.
 *
 * Obrigatória, ao contrário de `SettlePersonDto`: aquele endpoint preserva um
 * comportamento all-time anterior, este nasce mensal. Sem competência não há
 * pergunta a responder — "quanto esta pessoa me deve" só significa algo
 * dentro de um mês.
 */
export class MonthlySummaryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;
}
