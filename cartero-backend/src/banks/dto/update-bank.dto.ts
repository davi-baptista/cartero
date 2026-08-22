import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Os decorators não são só validação: com `whitelist: true` no ValidationPipe,
 * propriedade sem decorator é descartada. Sem eles, um PATCH de banco chegaria
 * ao serviço como objeto vazio e a edição não faria nada, sem erro.
 *
 * As regras espelham `CreateBankDto`, com tudo opcional.
 */
export class UpdateBankDto {
  @IsOptional()
  @IsString()
  name?: string;

  // Mantido por compatibilidade com clientes antigos; hoje é derivado do
  // vencimento e do intervalo (ver BanksService.update).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  invoiceCloseDate?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  invoiceDueDate?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  invoiceDueDaysAfterClose?: number;
}
