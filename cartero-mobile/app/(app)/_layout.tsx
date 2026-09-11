import { Stack } from 'expo-router'
import { theme } from '../../src/ui/theme'

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.color.background },
      }}
    />
  )
}
