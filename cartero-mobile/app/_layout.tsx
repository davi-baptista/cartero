import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { SessionProvider, useSession } from '../src/auth/session-provider'
import { theme } from '../src/ui/theme'

/**
 * Decide QUAL árvore renderizar a partir do estado da sessão.
 *
 * O invariante que importa: enquanto `bootstrapping`, nem login nem área
 * autenticada aparecem. Sem isso, abrir o app com sessão válida mostraria a
 * tela de login por uma fração de segundo antes de trocar sozinha — o
 * usuário lê isso como "fui deslogado".
 */
function SessionGate() {
  const { state } = useSession()

  if (state.status === 'bootstrapping') {
    return (
      <View style={styles.splash} accessibilityRole="progressbar">
        <ActivityIndicator color={theme.color.primary} size="large" />
      </View>
    )
  }

  const signedIn = state.status === 'signedIn' || state.status === 'refreshing'

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.color.background },
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>

      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  )
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SessionProvider>
        <SessionGate />
      </SessionProvider>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.background,
  },
})
