import { IsIn, IsOptional } from 'class-validator';
import type { BankStatusFilter } from '../banks.service';

/**
 * Recorte da listagem de bancos.
 *
 * Sem `status` a resposta traz os ativos — o caso de longe mais comum, e o que
 * todas as telas existentes esperam. `ARCHIVED` devolve só os arquivados,
 * porque a tela de arquivados é uma lista à parte, não um superconjunto.
 */
export class FindBanksDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: BankStatusFilter;
}
