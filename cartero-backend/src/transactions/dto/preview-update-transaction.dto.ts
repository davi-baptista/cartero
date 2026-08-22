import { UpdateTransactionDto } from './update-transaction.dto';
import { IsIn, IsOptional } from 'class-validator';

/**
 * Entrada da prévia de edição: o mesmo payload do update, mais o escopo.
 *
 * Herda de `UpdateTransactionDto` de propósito — a prévia precisa validar
 * exatamente o que a edição validaria, senão poderia prever uma operação que
 * o save recusa.
 */
export class PreviewUpdateTransactionDto extends UpdateTransactionDto {
  /** Quais parcelas a edição atinge. Ausente = `ONE`, como no update. */
  @IsOptional()
  @IsIn(['ONE', 'NEXT', 'ALL'])
  scope?: 'ONE' | 'NEXT' | 'ALL';
}
