package app.cartero.widgetsnapshot

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalContext
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
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
import androidx.glance.layout.width
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle

/**
 * O widget de Faturas na tela inicial.
 *
 * Mesmo desenho do `BudgetWidget` (M3): lê um arquivo e desenha. Não chama a
 * API, não tem token, não conhece sessão — tudo já foi resolvido pelo app
 * quando gravou `invoices-v1.json`. `GET /invoices/actionable` decidiu
 * quais bancos, qual invoice representa cada um, a ordem e o status; este
 * widget é puro presenter.
 */
class InvoicesWidget : GlanceAppWidget() {

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    // Leitura ANTES de `provideContent` — o corpo composable roda no
    // processo do launcher e não é lugar para tocar em disco.
    val state = InvoicesReader.read(context)
    val model = InvoicesWidgetPresenter.present(state, System.currentTimeMillis())

    provideContent {
      GlanceTheme {
        WidgetSurface(model)
      }
    }
  }
}

@Composable
private fun WidgetSurface(model: InvoicesWidgetUiModel) {
  val context = LocalContext.current

  /*
    O toque abre o app e nada mais — mesma postura do Budget Widget. Não
    existe ainda uma tela de Invoices no mobile para deep-linkar, e a intent
    não carrega nenhum dado do snapshot.
  */
  val launchIntent = context.packageManager
    .getLaunchIntentForPackage(context.packageName)

  /*
    Mesmo raio do Budget Widget (14.dp = `--radius-xl` do design system web)
    — os dois widgets compartilham a mesma linguagem visual do Cartero.

    Mesma cor de fundo do Budget também (M6.2) — `CarteroWidgetColors`, não
    `GlanceTheme.colors.widgetBackground`. Ver `CarteroWidgetColors.kt`: o
    token dinâmico do sistema varia por wallpaper/aparelho, não é a
    identidade do Cartero.
  */
  var surface = GlanceModifier
    .fillMaxSize()
    .background(CarteroWidgetColors.cardBackground)
    .cornerRadius(14.dp)
    .padding(16.dp)

  if (launchIntent != null) {
    surface = surface.clickable(actionStartActivity(launchIntent))
  }

  Column(modifier = surface) {
    when (model) {
      is InvoicesWidgetUiModel.Ready -> ReadyContent(model)
      is InvoicesWidgetUiModel.SignedOut -> MessageContent(model.title, model.message)
      is InvoicesWidgetUiModel.Unavailable -> MessageContent(model.title, model.message)
    }
  }
}

@Composable
private fun ReadyContent(model: InvoicesWidgetUiModel.Ready) {
  Text(
    text = model.title,
    style = TextStyle(
      fontSize = 11.sp,
      fontWeight = FontWeight.Medium,
      color = CarteroWidgetColors.secondaryTextProvider,
    ),
  )

  Spacer(modifier = GlanceModifier.height(8.dp))

  if (model.emptyMessage != null) {
    Text(
      text = model.emptyMessage,
      style = TextStyle(
        fontSize = 13.sp,
        color = CarteroWidgetColors.secondaryTextProvider,
      ),
    )
  } else {
    for (row in model.rows) {
      InvoiceRowContent(row)
    }
  }

  /*
    O rótulo de idade só aparece quando há espaço de sobra — 4×2 é
    restrito, e três rows já ocupam a altura disponível. Omitir aqui em vez
    de comprimir as linhas é a mesma escolha do Budget Widget: nunca sacar
    espaço de um fato canônico (a fatura) para uma metadata (a idade).
  */
  if (model.rows.size < InvoicesReader.MAX_ROWS) {
    model.staleText?.let { stale ->
      Spacer(modifier = GlanceModifier.height(4.dp))
      Text(
        text = stale,
        style = TextStyle(
          fontSize = 9.sp,
          color = CarteroWidgetColors.secondaryTextProvider,
        ),
      )
    }
  }
}

@Composable
private fun InvoiceRowContent(row: InvoiceRow) {
  Row(
    modifier = GlanceModifier
      .fillMaxWidth()
      .padding(vertical = 2.dp)
      .semantics { contentDescription = row.description },
    verticalAlignment = Alignment.Vertical.CenterVertically,
  ) {
    Column(modifier = GlanceModifier.defaultWeight()) {
      Text(
        text = row.bankName,
        maxLines = 1,
        style = TextStyle(
          fontSize = 13.sp,
          fontWeight = FontWeight.Medium,
          color = CarteroWidgetColors.primaryTextProvider,
        ),
      )
      Text(
        text = row.statusText,
        maxLines = 1,
        style = TextStyle(
          fontSize = 11.sp,
          color = CarteroWidgetColors.secondaryTextProvider,
        ),
      )
    }

    Spacer(modifier = GlanceModifier.width(8.dp))

    Text(
      text = row.amountText,
      maxLines = 1,
      style = TextStyle(
        fontSize = 13.sp,
        fontWeight = FontWeight.Medium,
        color = CarteroWidgetColors.primaryTextProvider,
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
        color = CarteroWidgetColors.secondaryTextProvider,
      ),
    )
    Spacer(modifier = GlanceModifier.height(6.dp))
    Text(
      text = message,
      style = TextStyle(
        fontSize = 14.sp,
        color = CarteroWidgetColors.primaryTextProvider,
      ),
    )
  }
}

/** Ponte do AppWidget do Android para o widget Glance de Faturas. */
class InvoicesWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = InvoicesWidget()
}
