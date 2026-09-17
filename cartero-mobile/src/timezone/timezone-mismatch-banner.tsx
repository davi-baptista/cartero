import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useSession } from '../auth/session-provider'
import { theme } from '../ui/theme'

export function TimezoneMismatchBanner() {
  const { timezoneMismatch, updateTimeZone, dismissTimezoneMismatch } = useSession()
  const [busy, setBusy] = useState(false)
  if (!timezoneMismatch) return null

  const accept = async () => {
    setBusy(true)
    try {
      await updateTimeZone(timezoneMismatch.device)
    } finally {
      setBusy(false)
    }
  }

  /*
    Este banner é montado em `(app)/_layout.tsx`, ACIMA do `<Stack>` — fora do
    `SafeAreaView` de qualquer tela individual. Sem seu próprio inset de
    topo, o texto ficava atrás da status bar (confirmado em runtime real,
    AVD `Cartero_API_36`: o relógio/ícones do sistema sobrepunham a primeira
    linha do aviso). `edges={['top']}` aplica só o padding que falta, sem
    duplicar o inset inferior que a tela por baixo já aplica no seu próprio
    `SafeAreaView`.
  */
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: theme.color.surface }}>
    <View style={{ padding: theme.space.md, backgroundColor: theme.color.surface, borderBottomWidth: 1, borderBottomColor: theme.color.border, gap: theme.space.sm }}>
      <Text style={{ color: theme.color.text, fontSize: theme.font.small }}>
        Este dispositivo está em {timezoneMismatch.device}, mas a conta usa {timezoneMismatch.account}.
      </Text>
      <Text style={{ color: theme.color.textMuted, fontSize: theme.font.small }}>
        Isso afeta datas financeiras e horários de notificações.
      </Text>
      <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
        <Pressable disabled={busy} onPress={() => void accept()} style={{ minHeight: theme.touchTarget, justifyContent: 'center' }}>
          <Text style={{ color: theme.color.primary, fontSize: theme.font.small, fontWeight: '700' }}>Atualizar</Text>
        </Pressable>
        <Pressable onPress={dismissTimezoneMismatch} style={{ minHeight: theme.touchTarget, justifyContent: 'center' }}>
          <Text style={{ color: theme.color.textMuted, fontSize: theme.font.small }}>Manter atual</Text>
        </Pressable>
      </View>
    </View>
    </SafeAreaView>
  )
}
