import { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useSession } from '../src/auth/session-provider'
import { AUTH_ERROR_MESSAGE } from '../src/auth/errors'
import { theme } from '../src/ui/theme'

export default function SignInScreen() {
  const { state, signIn } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const submitting = state.status === 'authenticating'
  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting

  const submit = () => {
    if (!canSubmit) return
    void signIn(email.trim(), password)
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.brand}>Cartero</Text>
            <Text style={styles.subtitle}>Entre para continuar</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label} nativeID="label-email">
              E-mail
            </Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="voce@exemplo.com"
              placeholderTextColor={theme.color.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              editable={!submitting}
              accessibilityLabelledBy="label-email"
              accessibilityLabel="E-mail"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label} nativeID="label-password">
              Senha
            </Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Sua senha"
              placeholderTextColor={theme.color.textMuted}
              /*
                A senha vive só neste estado, enquanto a tela existe. Nunca é
                persistida — nem em armazenamento seguro, que guarda apenas o
                refresh token.
              */
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={submit}
              editable={!submitting}
              accessibilityLabelledBy="label-password"
              accessibilityLabel="Senha"
            />
          </View>

          {state.error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {AUTH_ERROR_MESSAGE[state.error]}
            </Text>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              !canSubmit && styles.buttonDisabled,
              pressed && canSubmit && styles.buttonPressed,
            ]}
            onPress={submit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Entrar"
            accessibilityState={{ disabled: !canSubmit, busy: submitting }}
          >
            {submitting ? (
              <ActivityIndicator color={theme.color.primaryText} />
            ) : (
              <Text style={styles.buttonText}>Entrar</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.background },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: theme.space.lg,
    gap: theme.space.md,
  },
  header: { marginBottom: theme.space.lg },
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
  field: { gap: theme.space.sm },
  label: { color: theme.color.textMuted, fontSize: theme.font.small },
  input: {
    minHeight: theme.touchTarget,
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    color: theme.color.text,
    fontSize: theme.font.body,
  },
  error: { color: theme.color.danger, fontSize: theme.font.small },
  button: {
    minHeight: theme.touchTarget,
    backgroundColor: theme.color.primary,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.space.sm,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  buttonText: {
    color: theme.color.primaryText,
    fontSize: theme.font.body,
    fontWeight: '600',
  },
})
