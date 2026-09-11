import Constants from 'expo-constants'

/**
 * Endereço da API.
 *
 * NÃO é segredo: é um endereço público, e o app instalado o carrega em claro
 * de qualquer forma. Os segredos do Cartero (`JWT_SECRET`, `DATABASE_URL`,
 * chave VAPID privada, `CRON_SECRET`) vivem exclusivamente no backend e não
 * têm razão nenhuma para existir neste package.
 *
 * O padrão é `10.0.2.2`, que é como o emulador Android alcança o `localhost`
 * da máquina que o hospeda — `127.0.0.1` de dentro do emulador aponta para o
 * próprio emulador, e é o erro que faz o login "não responder" sem erro
 * visível. Em device físico, aponte para o IP da máquina na rede local.
 */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.carteroApiUrl as string | undefined) ??
  'http://10.0.2.2:3000'
