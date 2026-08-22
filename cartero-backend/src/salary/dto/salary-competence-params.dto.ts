import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/**
 * Competência vinda da URL (`/salary/:year/:month`).
 *
 * Params chegam como string; `@Type(() => Number)` converte antes de validar,
 * como em `GetSalaryDto`. Sem os limites, `/salary/99999/13` chegaria ao banco
 * como consulta válida e devolveria 404 por competência impossível — erro
 * certo pela razão errada.
 */
export class SalaryCompetenceParamsDto {
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
