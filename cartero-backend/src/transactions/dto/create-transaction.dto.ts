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

export class CreateTransactionDto {
  @IsUUID()
  bankId: string;

  @IsUUID()
  categoryId: string;

  @IsString()
  title: string;

  @IsEnum(TransactionType)
  type: TransactionType;

  /**
   * VALOR TOTAL da compra, não o da parcela.
   *
   * Com `installments > 1`, o backend divide este valor entre as parcelas
   * (`splitInstallmentAmount`), e a soma delas fecha exatamente com o total.
   * Uma compra de R$ 1.000 em 10x gera dez lançamentos de R$ 100.
   *
   * Cuidado: em `UpdateTransactionDto` o mesmo campo significa o valor de UMA
   * parcela — ver o comentário em `TransactionsService.update`.
   */
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsBoolean()
  isRefund?: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_INSTALLMENTS, { message: MAX_INSTALLMENTS_MESSAGE })
  installments?: number;

  @IsOptional()
  @IsUUID()
  personId?: string;
}
