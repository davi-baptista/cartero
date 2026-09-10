/**
 * ══════════════════════════════════════════════════════════════════════════
 * Os limites de parcelamento, num lugar só
 * ══════════════════════════════════════════════════════════════════════════
 *
 * O frontend limitava a 64 (`MAX_INSTALLMENTS` em
 * `lib/installment-count-field.ts`, mais o `max(64)` dos schemas de
 * Transação, Dívida e Recebível) e a API não tinha teto nenhum: os quatro
 * DTOs declaravam `@Min(1)` e nada acima.
 *
 * Uma chamada direta com `installments: 200` criava 200 lançamentos — e 200
 * faturas, no caso do cartão. A tela era a única coisa segurando o número.
 *
 * ── Por que uma constante, e não `@Max(64)` solto ──
 *
 * São QUATRO pontos que precisam do mesmo teto: criar transação, prévia de
 * transação, criar dívida e criar recebível. Repetir o literal em cada um
 * deixaria a próxima mudança pela metade, que é exatamente como o teto
 * nasceu ausente aqui.
 *
 * O valor é duplicado entre backend e frontend — não há pacote compartilhado
 * neste monorepo, e criar um só para dois números acoplaria os dois lados por
 * muito pouco. A duplicação é deliberada e está documentada dos dois lados;
 * o que não pode existir é divergência DENTRO do backend.
 *
 * ── O mínimo não mora aqui ──
 *
 * `MIN_INSTALLMENTS = 2` existe só no frontend, e continua assim. O payload
 * não carrega o modo de pagamento: `installments: 1` e `installments`
 * ausente são a MESMA coisa — compra à vista, normalizada por
 * `resolveInstallmentCount`. A API não tem como distinguir "escolheu
 * Parcelado e digitou 1" de "escolheu À vista", então recusar `1` quebraria
 * o caminho canônico. Quem garante "parcelado ⇒ >= 2" é o formulário, onde o
 * modo existe.
 */

/**
 * Máximo de parcelas que a API aceita.
 *
 * Espelha `MAX_INSTALLMENTS` do frontend. Mudar um lado sem o outro faz a
 * tela e a API discordarem — foi assim que o teto sumiu daqui.
 */
export const MAX_INSTALLMENTS = 64;

/** Mensagem única para o estouro, nos quatro DTOs. */
export const MAX_INSTALLMENTS_MESSAGE = `installments não pode ser maior que ${MAX_INSTALLMENTS}`;
