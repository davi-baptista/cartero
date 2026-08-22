import { TransactionType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * Quitar as pendências de uma pessoa numa COMPETÊNCIA.
 *
 * ─── Histórico desta decisão ──────────────────────────────────────────────
 *
 * A versão anterior aceitava `startDate`/`endDate` e o frontend mandava os
 * limites do mês visível — o que deixava a dívida vencida em junho aberta
 * enquanto o toast dizia "N itens quitados". A correção foi tornar a ação
 * all-time.
 *
 * Agora o drawer voltou a ser MENSAL, e all-time passou a ser o perigo oposto:
 * o usuário olha agosto e a ação quitaria também outubro, fora da tela.
 *
 * A solução não é aceitar datas de novo, nem uma lista de ids: é receber a
 * COMPETÊNCIA e o backend RECONSULTAR quais itens pertencem a ela, aplicando a
 * mesma regra que a tela usa (`belongsToCompetence`). O cliente diz qual mês
 * está olhando; quem decide o que é elegível é o servidor.
 *
 * Sem competência, o comportamento all-time é preservado — é o que
 * `PersonsService.settle` fazia, e outros consumidores podem depender dele.
 */
export class SettlePersonDto {
  /** Ano da competência. Junto com `month`, restringe o conjunto. */
  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsUUID()
  paymentBankId?: string;

  @IsOptional()
  @IsEnum(TransactionType)
  paymentType?: TransactionType;
}
