import * as SecureStore from 'expo-secure-store'
import type { SecureCredentialStore } from './types'

/**
 * A ÚNICA chave de credencial persistida pelo app.
 *
 * O access token não entra aqui: vive 15 minutos e é reconstruível pelo
 * refresh. A senha nunca é persistida em lugar nenhum.
 */
export const REFRESH_TOKEN_KEY = 'cartero.refreshToken'

/**
 * Armazenamento apoiado no Keychain (iOS) e no Keystore (Android).
 *
 * `expo-secure-store` é a autoridade do ecossistema para credencial. O
 * contraste que importa é com `AsyncStorage`: lá os dados ficam em texto
 * claro no diretório do app — legíveis em device com root/jailbreak e
 * capturáveis por backup. Para um token de 30 dias que o backend ainda não
 * sabe revogar, essa diferença é a proteção que resta.
 */
export const secureCredentialStore: SecureCredentialStore = {
  async getRefreshToken() {
    return SecureStore.getItemAsync(REFRESH_TOKEN_KEY)
  },

  async setRefreshToken(token: string) {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, {
      /*
        Só depois do primeiro desbloqueio: antes disso o Keychain do iOS não
        entrega o item, e uma restauração de sessão em background falharia
        sem motivo aparente. O item continua fora de backup para outro
        dispositivo por ser `ThisDeviceOnly`.
      */
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    })
  },

  async clear() {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY)
  },
}
