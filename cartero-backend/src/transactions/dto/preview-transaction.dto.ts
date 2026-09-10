import { TransactionType } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  MAX_INSTALLMENTS,
  MAX_INSTALLMENTS_MESSAGE,
} from 'src/common/constants/installments';

/**
 * Entrada da prévia de criação.
 *
 * Espelha `CreateTransactionDto` nos campos que afetam o resultado financeiro.
 * `categoryId` e `description` ficam de fora: não influenciam fatura, rateio
 * nem recebível, e exigi-los faria a prévia só aparecer depois de o usuário
 * escolher categoria.
 */
export class PreviewTransactionDto {
  @IsUUID()
  bankId: string;

  @IsString()
  title: string;

  @IsEnum(TransactionType)
  type: TransactionType;

  /** VALOR TOTAL da compra — rateado entre as parcelas, como no create. */
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_INSTALLMENTS, { message: MAX_INSTALLMENTS_MESSAGE })
  installments?: number;

  @IsOptional()
  @IsBoolean()
  isRefund?: boolean;

  @IsOptional()
  @IsUUID()
  personId?: string;
}
