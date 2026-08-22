import { TransactionType } from '@prisma/client';
import {
  IsDateString,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateTransactionDto {
  @IsOptional()
  @IsUUID()
  bankId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  /**
   * Valor de UMA parcela — aplicado a cada transação do escopo escolhido.
   *
   * Diferente de `CreateTransactionDto.amount`, que é o total da compra. A
   * divergência é intencional e preserva a compatibilidade com séries já
   * cadastradas; ver `TransactionsService.update`.
   */
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsBoolean()
  isRefund?: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @ValidateIf((o: UpdateTransactionDto) => o.personId !== null)
  @IsUUID()
  personId?: string | null;

  @IsOptional()
  @IsBoolean()
  confirmReopenClosedInvoice?: boolean;
}
