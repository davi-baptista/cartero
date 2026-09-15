package app.cartero.widgetsnapshot

import android.content.Context
import android.util.AtomicFile
import org.json.JSONObject
import java.util.Locale

/**
 * Leitura do Invoices Snapshot V1 pelo lado nativo.
 *
 * Mesmo desenho do `SnapshotReader` (Budget, M3): o widget roda no processo
 * do launcher, sem sessão e sem rede, então qualquer conteúdo inesperado —
 * arquivo ausente, truncado, versão futura, item malformado — precisa
 * terminar num estado desenhável, nunca numa exceção. Uma exceção aqui
 * aparece como widget quebrado, ou derruba o launcher inteiro.
 *
 * `GET /invoices/actionable` já decidiu tudo que é domínio financeiro: quais
 * bancos, qual invoice representa cada um, a ordem, o status, `actionDate`,
 * o valor pessoal. Este reader PRESERVA a resposta gravada pelo TypeScript —
 * não ordena, não filtra por status, não deduplica, não recalcula dinheiro.
 */

/** Um item de fatura, já validado — nunca contém mais do que estes 4 campos. */
data class InvoiceItem(
  val bankName: String,
  val status: String,
  /** Dia civil `YYYY-MM-DD`, como o backend entrega — nunca reinterpretado aqui. */
  val actionDate: String,
  val ownAmountCents: Long,
)

/** O que o arquivo diz, já reduzido ao que o widget sabe desenhar. */
sealed interface InvoicesState {
  data class Ready(
    val invoices: List<InvoiceItem>,
    val hideAmounts: Boolean,
    /** Instante da geração, em milissegundos UTC. */
    val generatedAtMillis: Long,
  ) : InvoicesState

  /** O app encerrou a sessão e neutralizou o arquivo. */
  data object SignedOut : InvoicesState

  /**
   * Não há nada legível: arquivo ausente, corrompido, versão desconhecida ou
   * READY incompleto. Colapsa num estado só — ver `SnapshotState.Unavailable`
   * (Budget) para o raciocínio completo: distinguir os quatro casos na tela
   * inicial exporia um detalhe interno que ninguém pode acionar.
   */
  data object Unavailable : InvoicesState
}

object InvoicesReader {
  const val SNAPSHOT_DIRECTORY = "cartero-widget"
  const val INVOICES_FILE = "invoices-v1.json"

  /** A única versão que este código entende. */
  const val SUPPORTED_VERSION = 1

  /** Cap de apresentação da V1 — nunca reordena antes de aplicar. Ver §41. */
  const val MAX_ROWS = 3

  private val VALID_STATUS = setOf("OVERDUE", "CLOSED", "OPEN")

  fun invoicesFile(context: Context): java.io.File =
    java.io.File(java.io.File(context.noBackupFilesDir, SNAPSHOT_DIRECTORY), INVOICES_FILE)

  fun read(context: Context): InvoicesState {
    val file = invoicesFile(context)
    if (!file.exists()) return InvoicesState.Unavailable

    val raw = try {
      String(AtomicFile(file).readFully(), Charsets.UTF_8)
    } catch (_: Exception) {
      return InvoicesState.Unavailable
    }

    return parse(raw)
  }

  /** Visível para teste — os casos de borda não deveriam exigir um device. */
  fun parse(raw: String?): InvoicesState {
    if (raw.isNullOrBlank()) return InvoicesState.Unavailable

    val json = try {
      JSONObject(raw)
    } catch (_: Exception) {
      return InvoicesState.Unavailable
    }

    // Versão diferente não é lida "na dúvida" — mesma régua do Budget.
    if (json.optInt("version", -1) != SUPPORTED_VERSION) {
      return InvoicesState.Unavailable
    }

    return when (json.optString("state")) {
      "signedOut" -> InvoicesState.SignedOut
      "ready" -> parseReady(json)
      else -> InvoicesState.Unavailable
    }
  }

  private fun parseReady(json: JSONObject): InvoicesState {
    val privacy = json.optJSONObject("privacy") ?: return InvoicesState.Unavailable
    if (!privacy.has("hideAmounts")) return InvoicesState.Unavailable

    val generatedAt = parseInstant(json.optString("generatedAt"))
      ?: return InvoicesState.Unavailable

    /*
      `ownerId` NÃO é lido aqui — nem para validar presença — mesma postura
      do `SnapshotReader` (Budget). Ele existe no arquivo só para o app
      (TypeScript) nunca reaproveitar o snapshot de outra conta; o widget
      não tem sessão, não identifica ninguém, e não tem uso legítimo para o
      campo. Um teste de superfície (`widget-surface.spec.ts`) vigia que
      nenhum código nativo do widget sequer mencione a string "ownerId".
    */

    val rawInvoices = json.optJSONArray("invoices") ?: return InvoicesState.Unavailable

    val invoices = mutableListOf<InvoiceItem>()
    for (i in 0 until rawInvoices.length()) {
      val item = rawInvoices.optJSONObject(i) ?: return InvoicesState.Unavailable
      invoices.add(parseInvoiceItem(item) ?: return InvoicesState.Unavailable)
    }

    return InvoicesState.Ready(
      // A ORDEM é preservada exatamente — nenhum sort/group/dedupe.
      invoices = invoices,
      hideAmounts = privacy.optBoolean("hideAmounts", true),
      generatedAtMillis = generatedAt,
    )
  }

  private fun parseInvoiceItem(item: JSONObject): InvoiceItem? {
    val bankName = item.optString("bankName")
    if (bankName.isEmpty()) return null

    val status = item.optString("status")
    if (status !in VALID_STATUS) return null

    val actionDate = item.optString("actionDate")
    if (!isValidCivilDate(actionDate)) return null

    val cents = item.readCents("ownAmountCents") ?: return null

    return InvoiceItem(
      bankName = bankName,
      status = status,
      actionDate = actionDate,
      ownAmountCents = cents,
    )
  }

  /** Aceita apenas valor numérico inteiro — nunca string, nunca fracionário. */
  private fun JSONObject.readCents(key: String): Long? {
    if (!has(key)) return null
    val value = opt(key)
    if (value !is Number) return null
    val asDouble = value.toDouble()
    if (asDouble != Math.floor(asDouble) || asDouble.isInfinite()) return null
    return value.toLong()
  }

  /**
   * `YYYY-MM-DD` estrutural e civilmente válida — sem `java.time.LocalDate`
   * (exigiria API 26 ou desugaring) e sem `SimpleDateFormat`/`Calendar`, que
   * normalizam datas impossíveis (2026-02-30 viraria 02/03) em vez de as
   * recusar. A validação é aritmética pura: dias-no-mês, incluindo bissexto.
   */
  private fun isValidCivilDate(value: String): Boolean {
    val match = CIVIL_DATE_REGEX.matchEntire(value) ?: return false
    val year = match.groupValues[1].toIntOrNull() ?: return false
    val month = match.groupValues[2].toIntOrNull() ?: return false
    val day = match.groupValues[3].toIntOrNull() ?: return false

    if (month !in 1..12) return false
    if (day !in 1..daysInMonth(year, month)) return false
    return true
  }

  private fun daysInMonth(year: Int, month: Int): Int {
    val days = intArrayOf(31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
    if (month == 2 && isLeapYear(year)) return 29
    return days[month - 1]
  }

  private fun isLeapYear(year: Int): Boolean =
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0

  private val CIVIL_DATE_REGEX = Regex("""^(\d{4})-(\d{2})-(\d{2})$""")

  /**
   * ISO-8601 UTC como o `toISOString()` do JavaScript produz — mesma
   * implementação do `SnapshotReader` (Budget), sem `java.time` para manter
   * o minSdk 24.
   */
  private fun parseInstant(value: String?): Long? {
    if (value.isNullOrEmpty()) return null

    return try {
      val format = java.text.SimpleDateFormat(
        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
        Locale.US,
      )
      format.timeZone = java.util.TimeZone.getTimeZone("UTC")
      format.parse(value)?.time
    } catch (_: Exception) {
      null
    }
  }
}
