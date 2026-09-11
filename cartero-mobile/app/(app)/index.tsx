import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useSession } from '../../src/auth/session-provider'
import { theme } from '../../src/ui/theme'
import type { AuthUser } from '../../src/auth/types'

/**
 * Área autenticada do M1.
 *
 * Deliberadamente SEM números financeiros. O propósito desta tela é provar o
 * caminho completo — credenciais → login nativo → Bearer → rota protegida —
 * e um painel com valores exigiria decidir qual pergunta eles respondem
 * (movimentado? sua parte?), que é trabalho do widget de Orçamento, não deste
 * milestone. Inventar um número aqui para "parecer pronto" seria pior que não
 * ter nenhum: o Cartero distingue esses conceitos com cuidado.
 */
export default function HomeScreen() {
  const { state, api, signOut } = useSession()
  const [probe, setProbe] = useState<
    { status: 'idle' | 'loading' } | { status: 'ok'; user: AuthUser } | { status: 'failed' }
  >({ status: 'idle' })

  useEffect(() => {
    let active = true
    setProbe({ status: 'loading' })

    api
      .authorized<AuthUser>('/users/me')
      .then((user) => {
        if (active) setProbe({ status: 'ok', user })
      })
      .catch(() => {
        if (active) setProbe({ status: 'failed' })
      })

    return () => {
      active = false
    }
  }, [api])

  const user = probe.status === 'ok' ? probe.user : state.user

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <View>
          <Text style={styles.brand}>Cartero</Text>
          <Text style={styles.subtitle}>Sessão ativa neste dispositivo</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Conta</Text>
          <Text style={styles.cardValue}>{user?.name ?? '—'}</Text>
          <Text style={styles.cardMuted}>{user?.email ?? '—'}</Text>

          <View style={styles.divider} />

          <Text style={styles.cardLabel}>Rota protegida</Text>
          <Text
            style={[
              styles.cardMuted,
              probe.status === 'failed' && styles.failed,
            ]}
            accessibilityRole={probe.status === 'failed' ? 'alert' : undefined}
          >
            {probe.status === 'loading' && 'Verificando…'}
            {probe.status === 'ok' && 'GET /users/me respondeu com a sessão'}
            {probe.status === 'failed' && 'Não foi possível consultar agora'}
            {probe.status === 'idle' && '—'}
          </Text>
        </View>

        <View style={styles.spacer} />

        <Pressable
          style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
          onPress={() => void signOut()}
          accessibilityRole="button"
          accessibilityLabel="Sair da conta neste dispositivo"
        >
          <Text style={styles.signOutText}>Sair</Text>
        </Pressable>

        {/*
          Honestidade sobre o que "Sair" faz. A arquitetura de token é
          stateless: o refresh token continua tecnicamente válido no servidor
          até expirar, e não existe lista de revogação. Prometer encerramento
          remoto seria falso — ver docs/RELEASE-GATES.md.
        */}
        <Text style={styles.signOutNote}>
          Sair remove a sessão apenas deste dispositivo.
        </Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.background },
  content: { flex: 1, padding: theme.space.lg, gap: theme.space.lg },
  brand: {
    color: theme.color.text,
    fontSize: theme.font.title,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
    marginTop: theme.space.xs,
  },
  card: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    gap: theme.space.xs,
  },
  cardLabel: { color: theme.color.textMuted, fontSize: theme.font.small },
  cardValue: {
    color: theme.color.text,
    fontSize: theme.font.body,
    fontWeight: '600',
  },
  cardMuted: { color: theme.color.textMuted, fontSize: theme.font.small },
  failed: { color: theme.color.danger },
  divider: {
    height: 1,
    backgroundColor: theme.color.border,
    marginVertical: theme.space.md,
  },
  spacer: { flex: 1 },
  signOut: {
    minHeight: theme.touchTarget,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
  signOutText: { color: theme.color.text, fontSize: theme.font.body },
  signOutNote: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    textAlign: 'center',
  },
})
