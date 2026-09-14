package app.cartero.widgetsnapshot

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalContext
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.LinearProgressIndicator
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.appwidget.action.actionStartActivity

/**
 * O widget de Orçamento na tela inicial.
 *
 * Ele lê um arquivo e desenha. Não chama a API, não tem token, não conhece
 * sessão nem competência — tudo isso já foi resolvido pelo app quando gravou
 * o snapshot. É essa ausência que torna o widget seguro: mesmo rodando no
 * processo do launcher, não há credencial para vazar.
 *
 * Glance não é Compose completo: o que se escreve aqui vira `RemoteViews`.
 * Onde um efeito visual exigiria contorcionismo, o layout cede — um widget
 * que funciona vale mais que um pixel perfeito que trava o launcher.
 */
class BudgetWidget : GlanceAppWidget() {

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    /*
      A leitura acontece ANTES de `provideContent`: o corpo composable roda no
      processo do launcher e não é lugar para tocar em disco.
    */
    val state = SnapshotReader.read(context)
    val model = BudgetWidgetPresenter.present(state, System.currentTimeMillis())

    provideContent {
      GlanceTheme {
        WidgetSurface(model)
      }
    }
  }
}

@Composable
private fun WidgetSurface(model: BudgetWidgetUiModel) {
  val context = LocalContext.current

  /*
    O toque abre o app e nada mais. O intent NÃO carrega valores, mês, dono
    nem qualquer parte do snapshot: um extra com dado financeiro seria
    observável por quem inspecionasse a intent.
  */
  val launchIntent = context.packageManager
    .getLaunchIntentForPackage(context.packageName)

  var surface = GlanceModifier
    .fillMaxSize()
    .background(GlanceTheme.colors.widgetBackground)
    .padding(16.dp)

  if (launchIntent != null) {
    surface = surface.clickable(actionStartActivity(launchIntent))
  }

  Column(modifier = surface) {
    when (model) {
      is BudgetWidgetUiModel.Ready -> ReadyContent(model)
      is BudgetWidgetUiModel.SignedOut -> MessageContent(model.title, model.message)
      is BudgetWidgetUiModel.Unavailable -> MessageContent(model.title, model.message)
    }
  }
}

@Composable
private fun ReadyContent(model: BudgetWidgetUiModel.Ready) {
  Text(
    text = model.title,
    style = TextStyle(
      fontSize = 11.sp,
      fontWeight = FontWeight.Medium,
      color = GlanceTheme.colors.onSurfaceVariant,
    ),
  )

  Spacer(modifier = GlanceModifier.height(10.dp))

  Row(modifier = GlanceModifier.fillMaxWidth()) {
    AmountBlock(
      value = model.paidValue,
      label = model.paidLabel,
      description = model.paidDescription,
      modifier = GlanceModifier.defaultWeight(),
    )
    AmountBlock(
      value = model.pendingValue,
      label = model.pendingLabel,
      description = model.pendingDescription,
      modifier = GlanceModifier.defaultWeight(),
    )
  }

  Spacer(modifier = GlanceModifier.height(12.dp))

  /*
    A barra só existe quando há total positivo. Sem obrigação no mês, tanto
    "cheia" quanto "vazia" afirmariam algo falso sobre o mês.

    Ela permanece com os valores mascarados: revela proporção, não quantia —
    decisão de produto aprovada para a V1.
  */
  model.progress?.let { progress ->
    LinearProgressIndicator(
      progress = progress,
      modifier = GlanceModifier.fillMaxWidth(),
      color = GlanceTheme.colors.primary,
      backgroundColor = GlanceTheme.colors.surfaceVariant,
    )
  }

  model.staleText?.let { stale ->
    Spacer(modifier = GlanceModifier.height(8.dp))
    Text(
      text = stale,
      style = TextStyle(
        fontSize = 10.sp,
        color = GlanceTheme.colors.onSurfaceVariant,
      ),
    )
  }
}

@Composable
private fun AmountBlock(
  value: String,
  label: String,
  description: String,
  modifier: GlanceModifier,
) {
  Column(
    /*
      A descrição vem do modelo, já mascarada quando é o caso. Deixar o leitor
      de tela anunciar o valor que a tela esconde inverteria a proteção contra
      quem está por perto.
    */
    modifier = modifier.semantics { contentDescription = description },
  ) {
    Text(
      text = value,
      style = TextStyle(
        fontSize = 20.sp,
        fontWeight = FontWeight.Bold,
        color = GlanceTheme.colors.onSurface,
      ),
    )
    Text(
      text = label,
      style = TextStyle(
        fontSize = 11.sp,
        color = GlanceTheme.colors.onSurfaceVariant,
      ),
    )
  }
}

@Composable
private fun MessageContent(title: String, message: String) {
  Column(
    modifier = GlanceModifier.fillMaxSize(),
    verticalAlignment = Alignment.Vertical.CenterVertically,
  ) {
    Text(
      text = title,
      style = TextStyle(
        fontSize = 11.sp,
        fontWeight = FontWeight.Medium,
        color = GlanceTheme.colors.onSurfaceVariant,
      ),
    )
    Spacer(modifier = GlanceModifier.height(6.dp))
    Text(
      text = message,
      style = TextStyle(
        fontSize = 14.sp,
        color = GlanceTheme.colors.onSurface,
      ),
    )
  }
}

/** Ponte do AppWidget do Android para o widget Glance. */
class BudgetWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = BudgetWidget()
}
