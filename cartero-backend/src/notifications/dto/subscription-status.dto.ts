import { IsString } from 'class-validator';

/**
 * Consulta se ESTE endpoint está registrado para o usuário autenticado.
 *
 * O endpoint viaja no BODY, nunca em query string. Endpoints de
 * `PushSubscription` são identificadores de entrega: em `GET
 * /notifications/status?endpoint=...` eles acabariam em access log, histórico
 * do navegador, proxy e monitoring — superfícies que ninguém revisa e que
 * guardam o valor por tempo indeterminado.
 */
export class SubscriptionStatusDto {
  @IsString()
  endpoint: string;
}
