import { Stack } from 'expo-router'
import { theme } from '../../src/ui/theme'
import { TimezoneMismatchBanner } from '../../src/timezone/timezone-mismatch-banner'

export default function AppLayout() {
  return (
    <>
      <TimezoneMismatchBanner />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.background } }} />
    </>
  )
}
