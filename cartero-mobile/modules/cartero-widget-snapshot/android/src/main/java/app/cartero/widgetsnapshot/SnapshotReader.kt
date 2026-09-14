package app.cartero.widgetsnapshot

import android.content.Context
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File

/**
 * Leitura do Snapshot V1 pelo lado nativo.
 *
 * O widget roda no processo do launcher, com execução curta e sem sessão. Ele
 * não chama a API, não tem token e não conhece Budget: lê este arquivo e
 * desenha. Por isso o reader precisa tratar como NORMAL tudo o que pode
 * encontrar — arquivo ausente, truncado, de uma versão futura — e nunca
 * lançar. Uma exceção aqui aparece como widget quebrado na tela inicial do
 * usuário, ou pior, derruba o launcher.
 *
 * `org.json` vem com o Android. Um serializador dedicado adicionaria peso e
 * superfície a um parse de oito campos.
 */

/** O que o arquivo diz, já reduzido ao que o widget sabe desenhar. */
sealed interface SnapshotState {
  /** Sessão ativa, com números da competência. */
  data class Ready(
    val month: Int,
    val year: Int,
    val currency: String,
    val totalToPayCents: Long,
    val totalPaidCents: Long,
    val totalPendingCents: Long,
    val hideAmounts: Boolean,
    /** Instante da geração, em milissegundos UTC. */
    val generatedAtMillis: Long,
  ) : SnapshotState

  /** O app encerrou a sessão e neutralizou o arquivo. */
  data object SignedOut : SnapshotState

  /**
   * Não há nada legível: arquivo ausente, corrompido, versão desconhecida ou
   * READY incompleto.
   *
   * Os quatro casos colapsam num estado só porque a resposta ao usuário é a
   * mesma — abrir o app resolve. Distinguir "corrompido" de "ausente" na tela
   * inicial exporia um detalhe interno que ninguém pode acionar.
   *
   * Importante: isto NÃO é "sessão expirada". Um widget adicionado antes do
   * primeiro sync cai aqui, e afirmar logout seria falso.
   */
  data object Unavailable : SnapshotState
}

object SnapshotReader {
  const val SNAPSHOT_DIRECTORY = "cartero-widget"
  const val SNAPSHOT_FILE = "snapshot-v1.json"

  /** A única versão que este código entende. */
  const val SUPPORTED_VERSION = 1

  fun snapshotFile(context: Context): File =
    File(File(context.noBackupFilesDir, SNAPSHOT_DIRECTORY), SNAPSHOT_FILE)

  fun read(context: Context): SnapshotState {
    val file = snapshotFile(context)
    if (!file.exists()) return SnapshotState.Unavailable

    val raw = try {
      String(AtomicFile(file).readFully(), Charsets.UTF_8)
    } catch (_: Exception) {
      return SnapshotState.Unavailable
    }

    return parse(raw)
  }

  /**
   * Interpreta o conteúdo. Visível para teste — é onde moram os casos de
   * borda, e exercitá-los não deveria exigir um device.
   */
  fun parse(raw: String?): SnapshotState {
    if (raw.isNullOrBlank()) return SnapshotState.Unavailable

    val json = try {
      JSONObject(raw)
    } catch (_: Exception) {
      return SnapshotState.Unavailable
    }

    /*
      Versão diferente não é lida "na dúvida". O widget é código INSTALADO:
      pode ficar semanas mais velho que o app que escreve o arquivo, e
      interpretar campos de um formato desconhecido produziria números errados
      na tela inicial sem nenhum erro aparecer.
    */
    if (json.optInt("version", -1) != SUPPORTED_VERSION) {
      return SnapshotState.Unavailable
    }

    return when (json.optString("state")) {
      "signedOut" -> SnapshotState.SignedOut
      "ready" -> parseReady(json)
      else -> SnapshotState.Unavailable
    }
  }

  private fun parseReady(json: JSONObject): SnapshotState {
    val privacy = json.optJSONObject("privacy") ?: return SnapshotState.Unavailable
    if (!privacy.has("hideAmounts")) return SnapshotState.Unavailable

    val budget = json.optJSONObject("budget") ?: return SnapshotState.Unavailable

    val month = budget.optInt("month", -1)
    if (month !in 1..12) return SnapshotState.Unavailable

    val year = budget.optInt("year", -1)
    if (year <= 0) return SnapshotState.Unavailable

    val currency = budget.optString("currency")
    if (currency.isEmpty()) return SnapshotState.Unavailable

    /*
      Os centavos precisam ser inteiros. `optLong` devolveria 0 para um campo
      ausente ou fracionário, e zero é uma AFIRMAÇÃO financeira — "você não
      deve nada". Preferimos o estado neutro a inventar esse fato.
    */
    val toPay = budget.readCents("totalToPayCents") ?: return SnapshotState.Unavailable
    val paid = budget.readCents("totalPaidCents") ?: return SnapshotState.Unavailable
    val pending = budget.readCents("totalPendingCents") ?: return SnapshotState.Unavailable

    val generatedAt = parseInstant(json.optString("generatedAt"))
      ?: return SnapshotState.Unavailable

    return SnapshotState.Ready(
      month = month,
      year = year,
      currency = currency,
      totalToPayCents = toPay,
      totalPaidCents = paid,
      totalPendingCents = pending,
      hideAmounts = privacy.optBoolean("hideAmounts", true),
      generatedAtMillis = generatedAt,
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
   * ISO-8601 UTC como o `toISOString()` do JavaScript produz.
   *
   * Sem `java.time` para manter o minSdk 24 — `Instant.parse` exige API 26 ou
   * desugaring, e este é o único ponto que precisaria dele.
   */
  private fun parseInstant(value: String?): Long? {
    if (value.isNullOrEmpty()) return null

    return try {
      val format = java.text.SimpleDateFormat(
        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
        java.util.Locale.US,
      )
      format.timeZone = java.util.TimeZone.getTimeZone("UTC")
      format.parse(value)?.time
    } catch (_: Exception) {
      null
    }
  }
}
