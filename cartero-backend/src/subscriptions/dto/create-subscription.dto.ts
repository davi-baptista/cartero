import { TransactionType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSubscriptionDto {
  @IsString()
  title: string;

  @IsUUID()
  bankId: string;

  /**
   * Categoria do lançamento gerado. Omitida cai na categoria de sistema
   * "Assinatura", que mantém o cadastro rápido — o campo existe para quem
   * quer classificar (Netflix em Streaming), não como obrigação.
   *
   * A posse é validada no serviço: um id de categoria de outro usuário é
   * recusado, porque o frontend não é fonte de segurança.
   */
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsEnum(TransactionType)
  type: TransactionType;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth: number;

  /**
   * Chave da tentativa de criação, gerada pelo cliente.
   *
   * Reenviar o mesmo POST com a mesma chave devolve a MESMA assinatura em vez
   * de criar outra — é o que torna o retry seguro depois de uma falha de rede
   * ou de geração. Não identifica a assinatura: duas "Netflix" idênticas são
   * um cadastro legítimo, e cada tentativa tem a sua chave.
   *
   * Opcional para não quebrar clientes que não a enviam.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  creationKey?: string;

  /** Primeiro ciclo coberto, "YYYY-MM". Imutável depois de criado. */
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'startedAt deve estar no formato YYYY-MM',
  })
  startedAt: string;
}
