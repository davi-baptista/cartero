package app.cartero.widgetsnapshot

import android.util.AtomicFile
import androidx.glance.appwidget.updateAll
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Armazenamento do Widget Snapshot no Android.
 *
 * Deliberadamente burro: grava e lê uma string. Não conhece Budget, moeda,
 * competência, sessão nem token — toda a semântica vive no TypeScript, que é
 * onde ela pode ser testada sem emulador. O que exige código nativo é apenas
 * o acesso a um diretório que o Expo não expõe.
 *
 * ── Por que não `expo-file-system` ──
 *
 * A API oferece `documentDirectory` e `cacheDirectory`. O primeiro entra no
 * Auto Backup do Android — os valores financeiros sairiam do aparelho para a
 * conta Google do usuário, e voltariam ao restaurar num aparelho novo, de
 * outra pessoa. O segundo pode ser apagado pelo sistema a qualquer momento,
 * e o widget passaria a piscar vazio sem motivo.
 *
 * `noBackupFilesDir` é privado ao app, sobrevive ao ciclo de vida do processo
 * e está fora do backup por definição da plataforma.
 */
class CarteroWidgetSnapshotModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CarteroWidgetSnapshot")

    /*
      Grava de forma ATÔMICA.

      `AtomicFile` escreve num arquivo de trabalho e só o promove ao nome
      final quando o conteúdo está inteiro. Uma escrita interrompida — o
      sistema mata o app no meio, a bateria acaba — deixa o snapshot ANTERIOR
      intacto, em vez de um JSON truncado que o widget não conseguiria ler.

      Um `FileOutputStream` direto truncaria o arquivo antes de escrever, e a
      janela entre truncar e terminar é exatamente onde o dado se perde.
    */
    AsyncFunction("write") { contents: String ->
      val atomic = AtomicFile(snapshotFile())
      var stream: FileOutputStream? = null

      try {
        stream = atomic.startWrite()
        stream.write(contents.toByteArray(Charsets.UTF_8))
        atomic.finishWrite(stream)
      } catch (error: IOException) {
        // Aborta explicitamente: sem isto o arquivo de trabalho ficaria para
        // trás e a próxima leitura poderia encontrá-lo.
        if (stream != null) atomic.failWrite(stream)
        throw error
      }

      /*
        O refresh vem DEPOIS do commit atômico, nunca antes.

        Invertida, a ordem faria o widget ler o arquivo no meio da escrita —
        exatamente a corrida que o `AtomicFile` existe para eliminar.

        A falha é engolida de propósito: o arquivo já está gravado e o
        armazenamento é a autoridade. Se o launcher não aceitar o pedido
        agora, o widget se atualiza no próximo ciclo; propagar o erro faria o
        app tratar um snapshot íntegro como escrita fracassada.
      */
      requestWidgetRefresh()
    }

    /** Devolve o conteúdo, ou `null` se ainda não existe. */
    AsyncFunction("read") {
      val atomic = AtomicFile(snapshotFile())
      if (!snapshotFile().exists()) return@AsyncFunction null

      try {
        String(atomic.readFully(), Charsets.UTF_8)
      } catch (error: IOException) {
        // Ilegível é equivalente a ausente: quem chama decide o estado neutro.
        null
      }
    }

    /** Caminho real, para inspeção em desenvolvimento. Não expõe conteúdo. */
    AsyncFunction("location") { snapshotFile().absolutePath }
  }

  /**
   * Pede ao launcher que redesenhe o widget.
   *
   * Sem isto, a tela inicial só mudaria no ciclo periódico — o usuário sairia
   * da conta e continuaria vendo os valores por horas.
   */
  private fun requestWidgetRefresh() {
    val context = appContext.reactContext ?: return

    CoroutineScope(Dispatchers.Main).launch {
      try {
        BudgetWidget().updateAll(context)
      } catch (_: Exception) {
        // Best-effort: ver o comentário em `write`.
      }
    }
  }

  private fun snapshotFile(): File {
    val context = appContext.reactContext ?: throw IllegalStateException(
      "contexto Android indisponível",
    )

    val directory = File(context.noBackupFilesDir, SNAPSHOT_DIRECTORY)
    if (!directory.exists()) directory.mkdirs()

    return File(directory, SNAPSHOT_FILE)
  }

  private companion object {
    const val SNAPSHOT_DIRECTORY = "cartero-widget"
    const val SNAPSHOT_FILE = "snapshot-v1.json"
  }
}
