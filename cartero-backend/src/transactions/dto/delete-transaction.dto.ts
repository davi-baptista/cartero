import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

/**
 * Confirmação da exclusão com escopo `OPEN`.
 *
 * Carrega o conjunto que o usuário viu na prévia. Se o servidor recalcular e
 * chegar a outro, a confirmação não vale para o conjunto novo — melhor
 * perguntar de novo do que apagar algo que não foi mostrado.
 *
 * Opcional de propósito: um cliente que não implemente a verificação continua
 * funcionando, apenas sem a proteção contra estado obsoleto.
 */
export class DeleteTransactionDto {
  @IsOptional()
  @IsArray()
  /* Uma série realista tem dezenas de parcelas; o teto barra abuso sem
     estorvar o uso legítimo. */
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  expectedDeletableIds?: string[];
}
