import { IsDateString } from 'class-validator';

/**
 * Corrige a data REAL de um acerto já concluído.
 *
 * Só a data viaja: valor, vencimento e contraparte de um item pago seguem
 * protegidos pelas guardas de quitação. Esta operação existe justamente para
 * corrigir a dimensão temporal sem afrouxar aquelas proteções.
 */
export class UpdateSettlementDateDto {
  /** Dia civil `YYYY-MM-DD` em que o dinheiro se moveu de fato. */
  @IsDateString()
  paidAt: string;
}
