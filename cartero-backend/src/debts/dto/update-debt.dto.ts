import { TransactionType } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class UpdateDebtDto {
  @IsOptional()
  @IsUUID()
  personId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  creditorName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsBoolean()
  isAlertEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @IsOptional()
  @IsUUID()
  paymentBankId?: string;

  @IsOptional()
  @IsEnum(TransactionType)
  paymentType?: TransactionType;

  /**
   * Data em que a dívida foi paga de fato.
   *
   * Faltava aqui. O `MarkAsPaidDialog` é compartilhado com Recebíveis e sempre
   * pediu a data, mas sem o campo no DTO o `ValidationPipe` (`whitelist: true`)
   * a descartava em silêncio e o serviço gravava `new Date()`. Quem registrasse
   * hoje um pagamento feito na semana passada via a data de hoje — e o mesmo
   * diálogo respeitava a escolha quando o item era uma cobrança.
   */
  @IsOptional()
  @IsDateString()
  paymentDate?: string;
}
