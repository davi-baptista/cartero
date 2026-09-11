# Contrato de compatibilidade de API

## A mudança de regime

Enquanto o Cartero teve **um só cliente**, remover ou renomear um campo era
seguro: o frontend é servido junto com o deploy, então cliente e servidor
mudam no mesmo instante. Foi sob essa premissa que campos foram removidos de
forma deliberada e correta — os espelhos de `GET /persons/:id/statement` na
Fase 8C, o `priorCarry` do Orçamento na Fase 9B.

**Um app instalado quebra essa premissa.** Ele pode ficar semanas sem
atualizar, e nesse intervalo chama a API de hoje com o código de antes. A
mesma remoção que antes era limpeza vira, agora, uma tela quebrada em produção
para quem não atualizou.

## A regra

A partir do M1, **todo endpoint ou campo consumido por uma versão instalada do
mobile faz parte de um contrato compatível**:

| Mudança | Permitida? |
|---|---|
| Acrescentar campo à resposta | **sim** |
| Acrescentar parâmetro opcional | **sim** |
| Acrescentar endpoint | **sim** |
| Remover campo consumido | **não**, sem transição |
| Renomear campo consumido | **não**, sem transição |
| Estreitar tipo ou domínio de valor | **não**, sem transição |
| Mudar semântica mantendo o nome | **não** — é a pior das quebras |

A última linha merece ênfase: trocar o significado de um campo sem trocar o
nome não quebra o parser, quebra o **número na tela**. Não há erro, não há
log — só um valor errado exibido com confiança. Se o significado mudar, o nome
muda junto, e o campo antigo convive durante a transição.

Isto é **regra de processo, não código em runtime**: não há verificação
automática, e não existe `/v1`. Versionamento de rota é uma resposta possível
se e quando uma quebra for inevitável — não algo a construir por antecipação.

## Superfície consumida hoje (M1)

| Endpoint | Campos |
|---|---|
| `POST /auth/mobile/login` | `accessToken`, `refreshToken`, `user{id,email,name}` |
| `POST /auth/mobile/refresh` | `accessToken`, `refreshToken` |
| `GET /users/me` | `id`, `email`, `name` |

Esta tabela cresce a cada milestone. Mantê-la atualizada é o que torna a
revisão do release gate possível — sem ela, "o que o mobile consome?" vira uma
arqueologia de código a cada deploy.

## Nota sobre o contrato web

`POST /auth/login` e `POST /auth/refresh` **não** fazem parte deste contrato: o
mobile não os usa. Eles continuam servindo o navegador, e o refresh token
segue saindo apenas por cookie `HttpOnly` — nunca no corpo da resposta.

Essa separação é vigiada por `cartero-backend/src/auth/mobile-auth-transport.spec.ts`.
