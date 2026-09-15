package app.cartero.widgetsnapshot

import java.math.BigDecimal
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * O que o widget de Faturas desenha, já resolvido.
 *
 * Mesmo desenho do `BudgetWidgetPresenter` (M3): separado da view porque a
 * decisão interessante não é de layout, é o que pode ou não aparecer. Com a
 * privacidade ligada, nenhum campo — visível ou de acessibilidade — pode
 * carregar o valor monetário real.
 *
 * Nada aqui é regra financeira. `GET /invoices/actionable` já decidiu quais
 * bancos, qual invoice representa cada um, a ordem, status e `actionDate`;
 * esta camada só formata e mascara o que já chegou pronto.
 */

private val PT_BR = Locale("pt", "BR")

/** Uma linha renderizável — nunca mais de `InvoicesReader.MAX_ROWS`. */
data class InvoiceRow(
  val bankName: String,
  /** "Venceu 10/09" / "Vence 20/09" / "Fecha 25/09" — já resolvido, sem relógio. */
  val statusText: String,
  val amountText: String,
  /**
   * O que o leitor de tela anuncia — campo separado para poder ser
   * verificado: com a privacidade ligada, esta string NUNCA contém o valor
   * real, mesmo que `amountText` mostre a máscara.
   */
  val description: String,
)

sealed interface InvoicesWidgetUiModel {
  data class Ready(
    /** "CARTERO · FATURAS" */
    val title: String,
    val rows: List<InvoiceRow>,
    /** Só aparece quando não há nenhuma fatura actionable — texto simples, não erro. */
    val emptyMessage: String?,
    val staleText: String?,
  ) : InvoicesWidgetUiModel

  data class SignedOut(val title: String, val message: String) : InvoicesWidgetUiModel

  /** Sem snapshot legível — NÃO é logout. Ver `BudgetWidgetUiModel.Unavailable`. */
  data class Unavailable(val title: String, val message: String) : InvoicesWidgetUiModel
}

object InvoicesWidgetPresenter {
  const val BRAND = "CARTERO"
  const val TITLE = "$BRAND · FATURAS"
  const val MASK = "••••••"
  const val EMPTY_MESSAGE = "Nenhuma fatura exige atenção"

  /** Mesma janela do Budget — uma política de frescor única no produto. */
  const val STALE_AFTER_HOURS = BudgetWidgetPresenter.STALE_AFTER_HOURS
  const val STALE_DATE_AFTER_HOURS = BudgetWidgetPresenter.STALE_DATE_AFTER_HOURS

  fun present(state: InvoicesState, nowMillis: Long): InvoicesWidgetUiModel =
    when (state) {
      is InvoicesState.Ready -> presentReady(state, nowMillis)

      InvoicesState.SignedOut -> InvoicesWidgetUiModel.SignedOut(
        title = BRAND,
        message = "Abra o Cartero para entrar",
      )

      InvoicesState.Unavailable -> InvoicesWidgetUiModel.Unavailable(
        title = BRAND,
        message = "Abra o Cartero para atualizar",
      )
    }

  private fun presentReady(
    state: InvoicesState.Ready,
    nowMillis: Long,
  ): InvoicesWidgetUiModel.Ready {
    val masked = state.hideAmounts

    /*
      Cap de APRESENTAÇÃO, não seleção de domínio: o backend já manda no
      máximo 3 (limit default de GET /invoices/actionable), então isto só
      protege o layout 4×2 caso um arquivo manual/futuro contenha mais — sem
      reordenar antes do corte. Ver M6 §41.
    */
    /*
      M6.2: o widget exibe o TOTAL da fatura (o que o banco cobra no
      vencimento). `InvoiceItem.totalAmountCents` é o ÚNICO campo monetário
      neste contrato — a parte própria (`ownAmountCents`) existe no read
      model do backend, mas nunca chega ao snapshot persistido nem a este
      reader: nada aqui tem como lê-la por engano.
    */
    val rows = state.invoices.take(InvoicesReader.MAX_ROWS).map { invoice ->
      InvoiceRow(
        bankName = invoice.bankName,
        statusText = statusTextFor(invoice.status, invoice.actionDate),
        amountText = if (masked) MASK else formatCents(invoice.totalAmountCents),
        description = if (masked) {
          "${invoice.bankName}, ${statusTextFor(invoice.status, invoice.actionDate)}, valor oculto"
        } else {
          "${invoice.bankName}, ${statusTextFor(invoice.status, invoice.actionDate)}, " +
            "valor ${formatCents(invoice.totalAmountCents)}"
        },
      )
    }

    return InvoicesWidgetUiModel.Ready(
      title = TITLE,
      rows = rows,
      emptyMessage = if (rows.isEmpty()) EMPTY_MESSAGE else null,
      staleText = staleTextFor(state.generatedAtMillis, nowMillis),
    )
  }

  /**
   * Mapeamento de apresentação aprovado para V1 — nunca recalculado a partir
   * do relógio atual. "Vence hoje"/"em 2 dias" pertenceriam a uma comparação
   * de `actionDate` com `now`, que esta camada NÃO faz: um snapshot com
   * horas de idade continuaria afirmando "vence amanhã" incorretamente.
   */
  private fun statusTextFor(status: String, actionDate: String): String {
    val civilDate = formatCivilDate(actionDate)
    return when (status) {
      "OVERDUE" -> "Venceu $civilDate"
      "CLOSED" -> "Vence $civilDate"
      "OPEN" -> "Fecha $civilDate"
      else -> civilDate // Nunca deveria chegar aqui — o reader já validou.
    }
  }

  /**
   * `YYYY-MM-DD` → `DD/MM`, por fatiamento de string — NUNCA por
   * `SimpleDateFormat`/`Calendar`/`Instant`, que introduziriam fuso do
   * device. `actionDate` é uma data CIVIL: o dia 01 do mês 09 é sempre
   * "01/09", em qualquer timezone.
   */
  private fun formatCivilDate(value: String): String {
    val parts = value.split("-")
    if (parts.size != 3) return value // Já validado pelo reader; defensivo.
    val (_, month, day) = parts
    return "$day/$month"
  }

  /**
   * Centavos → "R$ 446,24", sem ponto flutuante — mesma authority do
   * `BudgetWidgetPresenter.formatCents`, reutilizada em vez de duplicada.
   * `GET /invoices/actionable` sempre devolve BRL; não há campo de moeda no
   * contrato de Invoices (diferente do Budget) porque o produto Cartero é
   * mono-moeda hoje.
   */
  fun formatCents(cents: Long): String {
    val amount = BigDecimal.valueOf(cents, 2)
    val format = NumberFormat.getCurrencyInstance(PT_BR)
    return format.format(amount)
  }

  /** Mesma authority do Budget — uma política de frescor única no produto. */
  fun staleTextFor(generatedAtMillis: Long, nowMillis: Long): String? =
    BudgetWidgetPresenter.staleTextFor(generatedAtMillis, nowMillis)
}
