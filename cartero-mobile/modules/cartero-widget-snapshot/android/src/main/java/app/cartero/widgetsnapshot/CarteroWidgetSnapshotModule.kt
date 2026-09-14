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
      writeAtomically(snapshotFile(), contents)

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
    AsyncFunction("read") { readAtomically(snapshotFile()) }

    /*
      ── A preferência de privacidade, em arquivo SEPARADO ──

      Ela não entra no snapshot por uma razão de ciclo de vida: o logout
      neutraliza o snapshot, e a escolha de "mostrar valores" pertence à
      pessoa, não à sessão. Guardá-la junto faria cada logout apagar a
      decisão, e o usuário teria de optar de novo toda vez.

      Mesmo diretório sem backup: um opt-in para revelar saldo na tela
      inicial não pode reaparecer sozinho num aparelho novo restaurado da
      nuvem.
    */
    AsyncFunction("writePrivacy") { contents: String ->
      writeAtomically(privacyFile(), contents)
    }

    AsyncFunction("readPrivacy") { readAtomically(privacyFile()) }

    /*
      Pedido de redesenho isolado.

      A reescrita de privacidade muda o snapshot pelo mesmo caminho de
      `write`, mas há casos — como falha parcial — em que só o refresh é
      necessário. Expor a operação evita que a camada TypeScript tenha de
      gravar de novo só para provocar a atualização.
    */
    AsyncFunction("refreshWidget") { requestWidgetRefresh() }

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

  /**
   * Escrita atômica, compartilhada pelos dois arquivos.
   *
   * `AtomicFile` grava num arquivo de trabalho e só o promove quando o
   * conteúdo está inteiro. Interrompida — o sistema mata o app, a bateria
   * acaba — a versão ANTERIOR permanece, em vez de um JSON truncado.
   *
   * Isso importa em dobro para a privacidade: uma escrita partida que
   * resultasse em arquivo ilegível faria a próxima leitura cair no padrão.
   * O padrão é OCULTAR, então o pior caso esconde valores — nunca revela.
   */
  private fun writeAtomically(target: File, contents: String) {
    val atomic = AtomicFile(target)
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
  }

  /** Conteúdo do arquivo, ou `null` se ausente ou ilegível. */
  private fun readAtomically(target: File): String? {
    if (!target.exists()) return null

    return try {
      String(AtomicFile(target).readFully(), Charsets.UTF_8)
    } catch (_: IOException) {
      // Ilegível é equivalente a ausente: quem chama decide o estado neutro.
      null
    }
  }

  private fun privacyFile(): File = File(widgetDirectory(), PRIVACY_FILE)

  private fun snapshotFile(): File = File(widgetDirectory(), SNAPSHOT_FILE)

  private fun widgetDirectory(): File {
    val context = appContext.reactContext ?: throw IllegalStateException(
      "contexto Android indisponível",
    )

    val directory = File(context.noBackupFilesDir, SNAPSHOT_DIRECTORY)
    if (!directory.exists()) directory.mkdirs()

    return directory
  }

  private companion object {
    const val SNAPSHOT_DIRECTORY = "cartero-widget"
    const val SNAPSHOT_FILE = "snapshot-v1.json"
    const val PRIVACY_FILE = "privacy-v1.json"
  }
}
