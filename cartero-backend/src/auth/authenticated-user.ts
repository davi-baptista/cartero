/**
 * O que `@CurrentUser()` de fato devolve — nunca o `User` inteiro do Prisma.
 *
 * Controllers tipavam o parâmetro como `User` e liam `user.timeZone`, mas
 * `JwtStrategy.validate()` sempre devolveu só `{ id: payload.sub }`. O campo
 * era `undefined` em TODA request autenticada, para TODO usuário — a
 * timezone persistida nunca chegou a existir aqui, então o crash não
 * dependia de dado sujo (`GET /commitments`, `GET|POST|PATCH /subscriptions`,
 * `POST /invoices/:id/reopen`, `PATCH /banks/:id`, `POST|PATCH /transactions`
 * eram alcançáveis por qualquer usuário autenticado).
 *
 * `timeZone` vem do BANCO a cada request — nunca do claim do JWT. O valor é
 * editável pelo usuário (`PATCH /users/me`), e um claim assinado ficaria
 * stale até o token expirar (até 15min de defasagem, silenciosa).
 *
 * `string`, não `string | null`: o schema hardening (`User.timeZone` agora
 * `NOT NULL`) tornou persistir uma conta sem timezone um estado inválido a
 * nível de banco. O principal autenticado reflete essa garantia — nenhum
 * caller downstream precisa (nem deveria) tratar `null` aqui.
 */
export interface AuthenticatedUser {
  id: string;
  timeZone: string;
}
