import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useSession } from '../../src/auth/session-provider'
import { theme } from '../../src/ui/theme'
import { isSupportedTimeZone, supportedTimeZones } from '../../src/timezone/settings'

/**
 * Configurações do Cartero Mobile.
 *
 * Mínima de propósito: o M4 acrescenta uma decisão, não uma área de ajustes.
 * O conteúdo cresce quando houver o que ajustar.
 */

type ToggleState =
  | { status: 'loading' }
  | { status: 'ready'; showAmounts: boolean }
  | { status: 'saving'; showAmounts: boolean }
  | { status: 'error'; showAmounts: boolean }
  /**
   * A preferência foi persistida e ao menos um widget financeiro foi
   * atualizado, mas não todos (M5B: Budget e Invoices são reescritos
   * independentemente — não há transação de filesystem entre os dois).
   * O switch reflete o valor pedido, mas a tela não afirma sucesso integral.
   */
  | { status: 'partial'; showAmounts: boolean }

export default function SettingsScreen() {
  const { state, privacy, updateTimeZone } = useSession()
  const ownerId = state.user?.id ?? null
  const [timeZoneSearch, setTimeZoneSearch] = useState('')
  const [timeZoneDraft, setTimeZoneDraft] = useState(state.user?.timeZone ?? '')

  /*
    Começa em `loading`, e o switch aparece DESLIGADO.

    Mostrá-lo ligado enquanto a leitura acontece revelaria a escolha da conta
    anterior por uma fração de segundo — e, pior, sugeriria que os valores
    estão visíveis quando ninguém confirmou isso ainda.
  */
  const [toggle, setToggle] = useState<ToggleState>({ status: 'loading' })

  useEffect(() => {
    if (!ownerId) return
    let active = true

    privacy
      .getHideAmounts(ownerId)
      .then((hideAmounts) => {
        if (active) setToggle({ status: 'ready', showAmounts: !hideAmounts })
      })
      .catch(() => {
        // Falha na leitura resolve para oculto, como todo o resto.
        if (active) setToggle({ status: 'ready', showAmounts: false })
      })

    return () => {
      active = false
    }
  }, [ownerId, privacy])

  useEffect(() => {
    setTimeZoneDraft(state.user?.timeZone ?? '')
  }, [state.user?.id, state.user?.timeZone])

  const onToggle = useCallback(
    async (nextShow: boolean) => {
      if (!ownerId) return

      // Enquanto grava, novas mudanças ficam bloqueadas: ON/OFF/ON rápido
      // produziria escritas fora de ordem.
      setToggle({ status: 'saving', showAmounts: nextShow })

      const result = await privacy.setHideAmounts(ownerId, !nextShow)

      /*
        A interface reflete o que FICOU PERSISTIDO, não o que foi pedido.
        Confiar no estado otimista faria a tela afirmar "visível" enquanto o
        arquivo diz o contrário — e no caso de ocultar, essa mentira é o
        oposto de uma garantia de privacidade.
      */
      if (result.status === 'failed') {
        setToggle({ status: 'error', showAmounts: !nextShow })
        return
      }

      if (result.status === 'partial') {
        setToggle({ status: 'partial', showAmounts: !result.hideAmounts })
        return
      }

      setToggle({ status: 'ready', showAmounts: !result.hideAmounts })
    },
    [ownerId, privacy],
  )

  const showAmounts = toggle.status === 'loading' ? false : toggle.showAmounts
  const busy = toggle.status === 'loading' || toggle.status === 'saving'
  const timeZones = supportedTimeZones().filter((zone) =>
    zone.toLowerCase().includes(timeZoneSearch.trim().toLowerCase()),
  )
  const timeZoneChanged = timeZoneDraft !== (state.user?.timeZone ?? '')
  const timeZoneValid = timeZoneDraft.length > 0 && isSupportedTimeZone(timeZoneDraft)
  const [timeZoneSaving, setTimeZoneSaving] = useState(false)

  const saveTimeZone = async () => {
    if (!timeZoneValid || !timeZoneChanged) return
    setTimeZoneSaving(true)
    try {
      await updateTimeZone(timeZoneDraft)
    } finally {
      setTimeZoneSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            style={styles.back}
          >
            <Text style={styles.backText}>Voltar</Text>
          </Pressable>
          <Text style={styles.title}>Configurações</Text>
        </View>

        <Text style={styles.sectionLabel}>Widgets</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Mostrar valores nos widgets</Text>
              <Text style={styles.rowHint}>
                Esta preferência vale apenas para esta conta neste dispositivo.
              </Text>
            </View>

            {toggle.status === 'loading' ? (
              <ActivityIndicator color={theme.color.textMuted} />
            ) : (
              <Switch
                value={showAmounts}
                onValueChange={onToggle}
                disabled={busy}
                accessibilityRole="switch"
                /*
                  O rótulo fala como a pessoa pensa — "mostrar", ligado ou
                  desligado. O código interno continua usando `hideAmounts`,
                  mas expor a dupla negação ("ocultar: desativado") obrigaria
                  o leitor a inverter duas vezes para entender o estado.
                */
                accessibilityLabel="Mostrar valores nos widgets"
                accessibilityState={{ checked: showAmounts, disabled: busy }}
                trackColor={{
                  false: theme.color.border,
                  true: theme.color.primary,
                }}
              />
            )}
          </View>

          {toggle.status === 'error' ? (
            <Text style={styles.error} accessibilityRole="alert">
              Não foi possível atualizar a privacidade do widget. Tente
              novamente.
            </Text>
          ) : null}

          {toggle.status === 'partial' ? (
            <Text style={styles.error} accessibilityRole="alert">
              Nem todos os widgets puderam ser atualizados agora. Tente
              novamente.
            </Text>
          ) : null}
        </View>

        <Text style={styles.sectionLabel}>Conta</Text>
        <View style={styles.card}>
          <Text style={styles.rowTitle}>Timezone financeira</Text>
          <Text style={styles.rowHint}>
            Usada para hoje, competências, vencimentos, notificações e assinaturas. Não reescreve dados históricos.
          </Text>
          <Text style={styles.currentTimeZone}>
            {state.user?.timeZone ?? 'Timezone indisponível'}
          </Text>
          <TextInput
            value={timeZoneSearch}
            onChangeText={setTimeZoneSearch}
            placeholder="Pesquisar timezone"
            placeholderTextColor={theme.color.textMuted}
            style={styles.timeZoneInput}
            accessibilityLabel="Pesquisar timezone"
          />
          <View style={styles.timeZoneList}>
            {timeZones.slice(0, 12).map((zone) => (
              <Pressable
                key={zone}
                onPress={() => setTimeZoneDraft(zone)}
                style={[styles.zoneOption, timeZoneDraft === zone && styles.zoneOptionSelected]}
                accessibilityRole="button"
                accessibilityLabel={`Selecionar ${zone}`}
              >
                <Text style={styles.zoneText}>{zone}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => void saveTimeZone()}
            disabled={timeZoneSaving || !timeZoneChanged || !timeZoneValid}
            style={[styles.saveButton, (timeZoneSaving || !timeZoneChanged || !timeZoneValid) && styles.disabled]}
          >
            <Text style={styles.saveButtonText}>{timeZoneSaving ? 'Salvando…' : 'Salvar timezone'}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.background },
  content: { flex: 1, padding: theme.space.lg, gap: theme.space.md },
  header: { gap: theme.space.md },
  back: { minHeight: theme.touchTarget, justifyContent: 'center' },
  backText: { color: theme.color.primary, fontSize: theme.font.body },
  title: {
    color: theme.color.text,
    fontSize: theme.font.title,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  sectionLabel: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    minHeight: theme.touchTarget,
  },
  rowText: { flex: 1, gap: theme.space.xs },
  rowTitle: { color: theme.color.text, fontSize: theme.font.body },
  rowHint: { color: theme.color.textMuted, fontSize: theme.font.small },
  error: { color: theme.color.danger, fontSize: theme.font.small },
  currentTimeZone: { color: theme.color.text, fontSize: theme.font.small, fontWeight: '600' },
  timeZoneInput: {
    minHeight: theme.touchTarget,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.sm,
    color: theme.color.text,
    fontSize: theme.font.small,
  },
  timeZoneList: { gap: theme.space.xs, maxHeight: 240 },
  zoneOption: { minHeight: theme.touchTarget, justifyContent: 'center', paddingHorizontal: theme.space.sm, borderRadius: theme.radius.md },
  zoneOptionSelected: { backgroundColor: theme.color.background, borderColor: theme.color.primary, borderWidth: 1 },
  zoneText: { color: theme.color.text, fontSize: theme.font.small },
  saveButton: { minHeight: theme.touchTarget, borderRadius: theme.radius.md, backgroundColor: theme.color.primary, alignItems: 'center', justifyContent: 'center' },
  saveButtonText: { color: theme.color.background, fontSize: theme.font.small, fontWeight: '700' },
  disabled: { opacity: 0.45 },
})
