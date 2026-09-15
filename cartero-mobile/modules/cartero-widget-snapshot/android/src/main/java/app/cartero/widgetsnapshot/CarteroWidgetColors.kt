package app.cartero.widgetsnapshot

import androidx.compose.ui.graphics.Color
import androidx.glance.unit.ColorProvider

/**
 * Identidade visual do Cartero, portada para Glance (M6.2).
 *
 * ── Por que isto existe ──
 *
 * `GlanceTheme.colors.*`, sem um `colors =` explícito, resolve para
 * `DynamicThemeColorProviders` (API 31+): os tokens (`glance_colorPrimary`,
 * `glance_colorWidgetBackground`, etc.) apontam para
 * `@android:color/system_accent1_*` / `system_accent2_*` / `system_neutral*` —
 * a paleta Material You derivada do WALLPAPER do usuário. Isso não é a marca
 * Cartero: é tema do sistema Android, e muda de aparelho para aparelho, de
 * wallpaper para wallpaper. Auditado via decompilação do
 * `glance-1.2.0.aar` (`res/values-v31/values-v31.xml`):
 *
 *   glance_colorWidgetBackground → @android:color/system_accent2_50
 *   glance_colorOnSurface        → @android:color/system_neutral1_900
 *   glance_colorOnSurfaceVariant → @android:color/system_neutral2_700
 *   glance_colorPrimary          → @android:color/system_accent1_600
 *   glance_colorSurfaceVariant   → @android:color/system_neutral2_100
 *
 * Nenhum desses é derivado do Cartero. O card com leve matiz azulado visto no
 * AVD durante os testes é COINCIDÊNCIA do wallpaper padrão do emulador — não
 * um mapeamento estável.
 *
 * ── A adaptação ──
 *
 * Os valores abaixo vêm de `cartero-frontend/src/app/globals.css`, tema
 * `.dark` (o único tema que o Cartero tem — "tema dark obrigatório", CLAUDE.md).
 * Convertidos de oklch para sRGB (fórmula padrão oklch→linear-sRGB→sRGB),
 * não copiados como string oklch — Android/Glance não entende oklch.
 *
 *   --card             oklch(0.205 0 0)         → #171717
 *   --card-foreground  oklch(0.985 0 0)         → #fafafa
 *   --muted-foreground oklch(0.708 0 0)         → #a1a1a1
 *   --primary (dark)   oklch(0.640 0.210 272)   → #637bff
 *   --muted (dark)     oklch(0.269 0 0)         → #262626
 *
 * Aplicados via overloads que aceitam `Color`/`ColorProvider` diretamente
 * (`GlanceModifier.background(Color)`, `TextStyle(color = ColorProvider(...))`)
 * — não via um `ColorProviders` custom de 27 parâmetros nomeados: a mudança
 * fica cirúrgica, nos ~5 papéis que o widget realmente lê, sem tocar em
 * `GlanceTheme` nem exigir uma dependência nova.
 *
 * ── Dark-only, de propósito ──
 *
 * O Cartero não tem tema claro — inventar uma variante light aqui
 * descreveria um produto que não existe. Os mesmos valores valem
 * independente do modo do sistema (day/night), porque o Cartero não muda.
 */
object CarteroWidgetColors {
  val cardBackground = Color(0xFF171717)
  val primaryText = Color(0xFFFAFAFA)
  val secondaryText = Color(0xFFA1A1A1)
  val accent = Color(0xFF637BFF)
  val progressTrack = Color(0xFF262626)

  val cardBackgroundProvider = ColorProvider(cardBackground)
  val primaryTextProvider = ColorProvider(primaryText)
  val secondaryTextProvider = ColorProvider(secondaryText)
  val accentProvider = ColorProvider(accent)
  val progressTrackProvider = ColorProvider(progressTrack)
}
