import { IsDateString, IsOptional } from 'class-validator';

/**
 * Filtro do extrato de uma pessoa.
 *
 * O intervalo recorta APENAS o histórico (`period`), pelo `paidAt` de cada
 * item. Ele **não** afeta `summary` nem `pending`, que são o consolidado
 * atual: uma dívida vencida em junho e ainda aberta continua contando em
 * agosto, porque continua sendo uma obrigação em aberto.
 *
 * Antes da Fase 8B esse intervalo filtrava tudo — inclusive os totais, que
 * eram rotulados "no total" na tela. Ver `PersonsService.getStatement`.
 */
export class GetStatementDto {
  /** Início do recorte do histórico (`paidAt >= startDate`). */
  @IsOptional()
  @IsDateString()
  startDate?: string;

  /** Fim do recorte do histórico (`paidAt <= endDate`). */
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
