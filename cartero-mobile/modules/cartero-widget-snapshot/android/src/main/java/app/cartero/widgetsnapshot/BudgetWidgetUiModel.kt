package app.cartero.widgetsnapshot

import java.math.BigDecimal
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * O que o widget desenha, já resolvido.
 *
 * Separado da view porque a decisão interessante não é de layout: é o que
 * pode ou não aparecer. Um modelo puro permite afirmar em teste que, com a
 * privacidade ligada, NENHUM campo — visível ou de acessibilidade — carrega
 * valor monetário.
 *
 * Nada aqui é regra financeira. Os números chegam prontos do backend, via
 * snapshot; esta camada formata e mascara.
 */

private val PT_BR = Locale("pt", "BR")

/** Estados que a tela inicial pode mostrar. */
sealed interface BudgetWidgetUiModel {
  data class Ready(
    /** "CARTERO · SETEMBRO" */
    val title: String,
    val paidValue: String,
    val paidLabel: String,
    val pendingValue: String,
    val pendingLabel: String,
    /** `null` quando não há total positivo — a barra é omitida. */
    val progress: Float?,
    /** Só aparece quando os dados envelheceram. */
    val staleText: String?,
    /**
     * O que o leitor de tela anuncia.
     *
     * Campo separado justamente para poder ser verificado: esconder o valor
     * na tela e deixá-lo aqui seria vazamento silencioso, e quem usa TalkBack
     * em público é exatamente quem mais precisa da máscara.
     */
    val paidDescription: String,
    val pendingDescription: String,
  ) : BudgetWidgetUiModel

  /** Sessão encerrada: nada de mês, valor ou progresso. */
  data class SignedOut(val title: String, val message: String) :
    BudgetWidgetUiModel

  /** Sem snapshot legível — NÃO é logout. */
  data class Unavailable(val title: String, val message: String) :
    BudgetWidgetUiModel
}

object BudgetWidgetPresenter {
  const val BRAND = "CARTERO"
  const val MASK = "••••••"

  /** Abaixo disto, a idade do dado não merece ocupar espaço. */
  const val STALE_AFTER_HOURS = 6L

  /** A partir daqui, "há Xh" deixa de ser legível e vira data. */
  const val STALE_DATE_AFTER_HOURS = 24L

  private val MONTHS = arrayOf(
    "JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
    "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO",
  )

  fun present(state: SnapshotState, nowMillis: Long): BudgetWidgetUiModel =
    when (state) {
      is SnapshotState.Ready -> presentReady(state, nowMillis)

      SnapshotState.SignedOut -> BudgetWidgetUiModel.SignedOut(
        title = BRAND,
        message = "Abra o Cartero para entrar",
      )

      /*
        Copy diferente da de logout, de propósito. Um widget adicionado antes
        do primeiro sync cai aqui, e dizer "sessão expirada" afirmaria algo
        que não aconteceu.
      */
      SnapshotState.Unavailable -> BudgetWidgetUiModel.Unavailable(
        title = BRAND,
        message = "Abra o Cartero para atualizar",
      )
    }

  private fun presentReady(
    state: SnapshotState.Ready,
    nowMillis: Long,
  ): BudgetWidgetUiModel.Ready {
    val masked = state.hideAmounts

    return BudgetWidgetUiModel.Ready(
      /*
        O mês vem do SNAPSHOT, não do relógio. O app já resolveu a competência
        em America/Fortaleza; recalcular aqui poderia mostrar outubro num
        widget cujos números são de setembro.
      */
      title = "$BRAND · ${MONTHS[state.month - 1]}",

      paidValue = if (masked) MASK else formatCents(state.totalPaidCents, state.currency),
      paidLabel = "Pago",
      pendingValue = if (masked) MASK else formatCents(state.totalPendingCents, state.currency),
      pendingLabel = "A pagar",

      progress = progressOf(state.totalPaidCents, state.totalToPayCents),
      staleText = staleTextFor(state.generatedAtMillis, nowMillis),

      paidDescription = if (masked) {
        "Valor pago oculto"
      } else {
        "Pago: ${formatCents(state.totalPaidCents, state.currency)}"
      },
      pendingDescription = if (masked) {
        "Valor a pagar oculto"
      } else {
        "A pagar: ${formatCents(state.totalPendingCents, state.currency)}"
      },
    )
  }

  /**
   * Centavos → "R$ 446,24", sem passar por ponto flutuante.
   *
   * `BigDecimal(cents, 2)` desloca a vírgula de forma exata. Dividir por 100
   * em `Double` reintroduziria o erro de representação que o M2 eliminou ao
   * gravar inteiros.
   */
  fun formatCents(cents: Long, currencyCode: String): String {
    val amount = BigDecimal.valueOf(cents, 2)
    val format = NumberFormat.getCurrencyInstance(PT_BR)

    try {
      format.currency = java.util.Currency.getInstance(currencyCode)
    } catch (_: Exception) {
      // Código desconhecido: mantém o padrão pt-BR em vez de falhar.
    }

    return format.format(amount)
  }

  /**
   * Proporção paga, só para desenhar a barra.
   *
   * `null` quando não há total positivo: uma barra cheia diria "tudo pago" e
   * uma vazia diria "nada pago" — as duas afirmam algo sobre um mês que não
   * tem obrigação nenhuma. Omitir é a única leitura honesta.
   */
  fun progressOf(paidCents: Long, totalCents: Long): Float? {
    if (totalCents <= 0L) return null

    val ratio = paidCents.toDouble() / totalCents.toDouble()
    return ratio.coerceIn(0.0, 1.0).toFloat()
  }

  /**
   * A idade do dado, quando ela importa.
   *
   * O M2 preserva o último snapshot bom quando o sync falha, então o widget
   * pode estar mostrando números de horas atrás. Dizer isso é o que separa
   * "dado velho" de "dado errado" — sem o rótulo, o usuário confiaria num
   * número que o servidor já não confirma.
   */
  fun staleTextFor(generatedAtMillis: Long, nowMillis: Long): String? {
    val elapsed = nowMillis - generatedAtMillis
    if (elapsed < 0) return null

    val hours = elapsed / 3_600_000L
    if (hours < STALE_AFTER_HOURS) return null

    if (hours < STALE_DATE_AFTER_HOURS) return "Atualizado há ${hours}h"

    val format = SimpleDateFormat("dd/MM", PT_BR)
    format.timeZone = TimeZone.getDefault()
    return "Atualizado em ${format.format(java.util.Date(generatedAtMillis))}"
  }
}
