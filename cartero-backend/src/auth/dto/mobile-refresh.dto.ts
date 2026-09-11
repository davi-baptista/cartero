import { IsString, MinLength } from 'class-validator';

/**
 * Transporte do refresh token para clientes NATIVOS.
 *
 * O navegador continua recebendo e devolvendo o refresh token por cookie
 * `HttpOnly` — ele nunca passa por aqui. Um app nativo não tem jar de cookie
 * de browser, então precisa de um transporte explícito, e o BODY é o único
 * lugar aceitável: query string vaza em log de proxy, em histórico e em
 * Referer; header customizado não acrescenta proteção nenhuma sobre o body
 * numa conexão TLS.
 *
 * `MinLength(1)` em vez de `IsJWT()`: a validação de forma do token pertence
 * ao `AuthService`, que já o verifica com a chave. Recusar aqui por formato
 * produziria 400 onde o contrato manda 401 — dois erros diferentes para o
 * mesmo fato ("este refresh token não serve").
 */
export class MobileRefreshDto {
  @IsString()
  @MinLength(1)
  refreshToken: string;
}
