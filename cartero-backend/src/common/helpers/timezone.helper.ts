/**
 * ══════════════════════════════════════════════════════════════════════════
 * Validação/canonicalização de timezone IANA (TZ1 — foundation)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `User.timeZone` persiste um identificador IANA (`America/Sao_Paulo`), nunca
 * um offset (`-03:00`, `UTC-3`). Isso importa porque offsets não capturam
 * horário de verão nem mudanças de regra futuras — o mesmo motivo pelo qual
 * o resto do produto já trata timezone como conceito regional, não numérico.
 *
 * `Intl.DateTimeFormat(undefined, { timeZone })` sozinho NÃO basta: ele aceita
 * `-03:00` como timezone válido (e o devolve como "canônico"), o que
 * persistiria exatamente o formato que este campo existe para evitar.
 * `Intl.supportedValuesOf('timeZone')` é a lista real de identificadores IANA
 * que o runtime reconhece (417 valores no Node 20/22 testado) — nunca inclui
 * um offset — e é isso que valida aqui.
 *
 * ── Por que validate e canonicalize vivem numa função só ──
 *
 * Existiam antes como duas funções separadas (`isValidIanaTimeZone` +
 * `canonicalizeTimeZone`), e nada impedia um call site persistir o input
 * validado sem NUNCA chamar a canonicalização — que é exatamente o que
 * aconteceu em `AuthService.register`/`UsersService.update` até esta rodada
 * (TZ1.0.1). `resolveIanaTimeZone` funde as duas etapas: quem grava só tem
 * um valor para escrever, o já-canônico, e não existe caminho de código que
 * escreva o raw input validado sem passar por ela.
 *
 * `Intl.supportedValuesOf('timeZone')` só contém identificadores JÁ
 * canônicos (aliases regionais como `Brazil/East` não aparecem nela, mesmo
 * sendo reconhecidos por `Intl.DateTimeFormat`) — então, para todo valor que
 * passa nesta validação, canonicalizar é uma operação de identidade hoje.
 * A função continua chamando `Intl.DateTimeFormat().resolvedOptions()`
 * explicitamente (em vez de devolver `value` direto) para não depender dessa
 * coincidência: se o runtime um dia canonicalizar um valor da própria lista
 * para outro (não observado em nenhum teste), o contrato ainda seria
 * respeitado sem precisar mudar quem chama.
 */

const VALID_TIME_ZONES = new Set(Intl.supportedValuesOf('timeZone'));

/**
 * `true` quando `value` é um identificador IANA reconhecido pelo runtime.
 *
 * Rejeita silenciosamente qualquer coisa que não esteja na lista — incluindo
 * offsets (`-03:00`), abreviações (`GMT-3`) e strings vazias/inválidas.
 *
 * Exportada separadamente porque alguns call sites (validação de DTO, antes
 * de decidir se lança 400) só precisam saber SE é válido, sem ainda querer
 * o valor canônico — mas nenhuma escrita em banco deve usar só esta função
 * sem em seguida chamar `resolveIanaTimeZone` para obter o valor a persistir.
 */
export function isValidIanaTimeZone(value: string): boolean {
  return VALID_TIME_ZONES.has(value);
}

/**
 * Valida e canonicaliza num único passo — a única função que qualquer
 * write path deveria chamar antes de persistir `User.timeZone`.
 *
 * `null` quando `value` não é um identificador IANA reconhecido. Nunca
 * lança — quem chama decide o erro de negócio (DTO/service já fazem isso
 * com `BadRequestException` + `INVALID_TIME_ZONE`).
 */
export function resolveIanaTimeZone(value: string): string | null {
  if (!isValidIanaTimeZone(value)) return null;

  return Intl.DateTimeFormat(undefined, { timeZone: value }).resolvedOptions()
    .timeZone;
}
