# Cartero Mobile

App companheiro do Cartero. **Não** é uma reprodução do Cartero Web: existe
para levar o produto ao celular e, adiante, para alimentar os widgets de tela
inicial.

A autoridade financeira continua no backend. O app consome read models já
calculados e não reimplementa regra de domínio — nada de matemática de
Orçamento, netting de pessoas, `ownAmount` de fatura ou semântica de
quitação.

## Estado atual — M1

Foundation e autenticação nativa. Sem widgets, sem snapshot, sem telas
financeiras.

## Requisitos

- Node 22+
- Backend do Cartero rodando (veja `cartero-backend`)
- Para rodar em dispositivo: **development build** (Expo Go não serve — ver
  abaixo)

## Configuração

```bash
npm install
cp .env.example .env     # ajuste EXPO_PUBLIC_API_URL
```

`EXPO_PUBLIC_API_URL` aponta para o backend. Do emulador Android, `localhost`
é o próprio emulador — use `10.0.2.2` para alcançar a máquina que o hospeda.

## Rodando

```bash
npm run android    # gera o projeto nativo e instala o development build
npm run ios        # idem no macOS
npm start          # servidor de desenvolvimento (--dev-client)
```

### Expo Go não é a arquitetura alvo

O app declara `expo-secure-store` e, nos próximos milestones, terá extensões
de widget. Nada disso existe no runtime do Expo Go: ele carrega um conjunto
fixo de módulos nativos. O development build é o alvo desde o M1 — descobrir
isso no M3, com o widget pronto e sem onde rodar, seria caro.

`ios/` e `android/` **não** são versionados: são gerados por `expo prebuild` a
partir de `app.json` e dos config plugins. Versioná-los criaria uma segunda
fonte de verdade que diverge da configuração em silêncio.

## Verificação

```bash
npm test           # lógica de sessão, credencial e coordenação de refresh
npm run typecheck
npm run doctor     # saúde das dependências do Expo
```

Os testes não montam o runtime do React Native. O que precisa de proteção aqui
é a máquina de sessão, e ela foi escrita sem importar `react-native` nem
`expo-secure-store` justamente para ser testável — uma propriedade verificada
por `credential-surface.spec.ts`, não apenas pretendida.

## Autenticação

```
login    → POST /auth/mobile/login    → { accessToken, refreshToken, user }
refresh  → POST /auth/mobile/refresh  → { accessToken, refreshToken }
```

Rotas **separadas** das do navegador. A separação é arquitetural, não um
header: a rota web continua sem devolver o refresh token ao JavaScript, então
o benefício do cookie `HttpOnly` permanece intacto para o browser. Distinguir
os clientes por `User-Agent` seria teatro — ambos são triviais de forjar.

| Credencial | Onde vive | Por quê |
|---|---|---|
| access token (15 min) | **memória** | reconstruível pelo refresh; persistir não compra nada |
| refresh token (30 dias) | **Keychain / Keystore** | credencial longa; `AsyncStorage` a deixaria em texto claro |
| senha | **em lugar nenhum** | some com a tela |

**Rede indisponível não é credencial inválida.** Se o bootstrap falhar por
falta de conexão, a credencial guardada **permanece** — apagá-la faria o
usuário perder a sessão por estar sem sinal.

**"Sair" é local.** O refresh token continua tecnicamente válido no servidor
até expirar; não existe revogação. Ver `docs/RELEASE-GATES.md`.

## Documentos

- `docs/RELEASE-GATES.md` — o que resolver antes de distribuir a terceiros
- `docs/API-COMPATIBILITY.md` — o contrato que um app instalado impõe à API
