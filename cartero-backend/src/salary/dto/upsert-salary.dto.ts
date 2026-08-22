import { IsInt, IsNumber, Max, Min } from 'class-validator';

/**
 * Define a renda a partir de uma competência.
 *
 * A granularidade é mensal: para o orçamento não importa que a mudança tenha
 * ocorrido no dia 17. O valor passa a valer no mês informado e segue valendo
 * até a próxima entrada — sem sobrescrever entradas posteriores.
 */
export class UpsertSalaryDto {
  /**
   * Renda mensal.
   *
   * Zero é aceito: significa "renda conhecida e igual a zero", diferente de
   * não haver registro para o período.
   */
  @IsNumber()
  @Min(0)
  amount: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;
}
