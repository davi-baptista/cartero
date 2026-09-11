# Release gates — Cartero Mobile

Itens que **não** bloqueiam o desenvolvimento privado (incluindo os widgets),
mas que precisam estar resolvidos **antes** de qualquer distribuição a
terceiros:

- TestFlight com testadores externos
- Play Internal Testing com terceiros
- App Store
- Play Store

---

## 1. Revogação de sessão nativa

**Estado: PENDENTE. Decisão consciente do M1, não esquecimento.**

A autenticação do Cartero é stateless: o refresh token é um JWT assinado com
validade de 30 dias, sem registro em banco. Disso decorrem três fatos que a
interface **não pode contradizer**:

| Fato | Consequência |
|---|---|
| Não existe lista de revogação | `logout` não invalida o token no servidor |
| Não há rotação com invalidação | o par anterior continua válido até expirar |
| Não há modelo de dispositivo | não é possível listar nem encerrar sessões |

Na web isso é um risco contido — o token vive em cookie `HttpOnly`, de mesma
origem, inacessível ao JavaScript. **Em um app instalado o regime muda**: a
credencial de 30 dias reside no dispositivo, e um token extraído vale por todo
esse prazo sem que ninguém possa cancelá-lo.

Por isso o app diz **"Sair remove a sessão apenas deste dispositivo"**, e
`SessionMachine.signOut` está documentado como encerramento local. Nenhuma
copy promete revogação remota, porque ela não acontece.

**O que o gate exige:**

- modelo de sessão persistido (dispositivo, emissão, último uso);
- rotação de refresh token com invalidação do anterior;
- detecção de reuso (um token já rotacionado que reaparece indica cópia);
- endpoint de revogação e "encerrar sessão neste/em todos os dispositivos";
- `logout` passando a revogar de fato — e a copy do app acompanhando.

## 2. Revisão de compatibilidade de API

Ver `docs/API-COMPATIBILITY.md`. Antes de distribuir, confirmar que todo campo
consumido pela versão instalada continua presente no backend em produção.

Um app instalado pode ficar semanas sem atualizar — a premissa de "cliente
sempre atualizado" que vale para a web **não vale aqui**.

## 3. Identificadores de loja

Hoje o app usa identificadores **provisionais de desenvolvimento**:

```
ios.bundleIdentifier : app.cartero.mobile.dev
android.package      : app.cartero.mobile.dev
```

O sufixo `.dev` é deliberado: nada foi registrado na Apple nem no Google, e
nenhuma decisão irreversível de loja foi tomada. Definir os identificadores
definitivos é parte deste gate — trocá-los depois da publicação significa um
app novo, sem continuidade de instalação.
