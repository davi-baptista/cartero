import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/*
  ── A superfície do código que roda no launcher ──

  O widget executa no processo do launcher, fora do app. Os testes de
  comportamento provam o que ele DESENHA; este arquivo prova o que ele NÃO
  PODE alcançar.

  A distinção importa porque a regressão perigosa aqui não muda saída nenhuma:
  alguém adiciona um cliente HTTP "só para atualizar mais rápido", ou lê o
  token "só para autenticar a chamada", e todos os testes de render continuam
  verdes. O widget passa a carregar credencial num processo que não é o do
  app, e nada quebra até vazar.
*/

const NATIVE_ROOT = join(
  import.meta.dirname,
  '..',
  '..',
  'modules',
  'cartero-widget-snapshot',
  'android',
  'src',
  'main',
)

function kotlinSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return kotlinSources(full)
    return entry.endsWith('.kt') ? [full] : []
  })
}

/** Remove comentários: a verificação é sobre o código, não sobre a prosa. */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const sources = kotlinSources(NATIVE_ROOT).map((path) => ({
  path,
  text: stripComments(readFileSync(path, 'utf-8')),
}))

describe('o que o código nativo do widget pode alcançar', () => {
  it('há fontes Kotlin para inspecionar', () => {
    // Sem isto, um erro de caminho faria tudo abaixo passar sobre lista vazia.
    expect(sources.length).toBeGreaterThanOrEqual(3)
  })

  it('nenhuma capacidade de rede', () => {
    /*
      O widget lê um arquivo. Um cliente HTTP aqui significaria requisição a
      partir do processo do launcher — e requisição autenticada exigiria
      credencial, que é justamente o que o desenho do snapshot elimina.
    */
    const proibidos = [
      /\bHttpURLConnection\b/,
      /\bOkHttp/,
      /\bRetrofit/,
      /\bjava\.net\.URL\b/,
      /\bSocket\b/,
      /\bhttps?:\/\//,
    ]

    for (const { path, text } of sources) {
      for (const padrao of proibidos) {
        expect(padrao.test(text), `${path} casou ${padrao}`).toBe(false)
      }
    }
  })

  it('nenhum acesso a credencial', () => {
    const proibidos = [
      /SecureStore/i,
      /\baccessToken\b/,
      /\brefreshToken\b/,
      /\bAuthorization\b/i,
      /\bBearer\b/i,
      /\bpassword\b/i,
      /EncryptedSharedPreferences/,
      /\bKeyStore\b/,
    ]

    for (const { path, text } of sources) {
      for (const padrao of proibidos) {
        expect(padrao.test(text), `${path} casou ${padrao}`).toBe(false)
      }
    }
  })

  it('o ownerId não é lido pelo widget', () => {
    /*
      O campo existe no arquivo — é o que impede o saldo de A aparecer para B
      — mas ele identifica uma pessoa e não tem função de exibição. O reader
      nativo sequer o extrai.
    */
    for (const { path, text } of sources) {
      expect(/ownerId/.test(text), `${path} lê ownerId`).toBe(false)
    }
  })

  it('o conteúdo do snapshot nunca vai para log', () => {
    /*
      `Log.d(TAG, json)` despejaria os valores financeiros no logcat, legível
      por qualquer ferramenta de depuração conectada ao aparelho.
    */
    for (const { path, text } of sources) {
      expect(/\bLog\.[dviwe]\s*\(/.test(text), `${path} usa Log`).toBe(false)
      expect(/println\s*\(/.test(text), `${path} usa println`).toBe(false)
    }
  })

  it('o storage continua fora do backup e privado ao app', () => {
    const reader = sources.find((f) => f.path.endsWith('SnapshotReader.kt'))!

    expect(reader.text).toContain('noBackupFilesDir')
    // Nada de armazenamento externo ou compartilhado.
    expect(reader.text).not.toMatch(/getExternal|Environment\.|MODE_WORLD/)
  })

  it('o receiver não é exportado', () => {
    /*
      O AppWidgetManager é do sistema e alcança o receiver mesmo assim.
      Exportar abriria o componente para qualquer app do aparelho.
    */
    const manifest = readFileSync(join(NATIVE_ROOT, 'AndroidManifest.xml'), 'utf-8')

    expect(manifest).toContain('android:exported="false"')
    expect(manifest).not.toContain('android:exported="true"')
  })

  it('o widget é apenas de tela inicial, no tamanho aprovado', () => {
    const info = readFileSync(
      join(NATIVE_ROOT, 'res', 'xml', 'cartero_budget_widget_info.xml'),
      'utf-8',
    )

    expect(info).toContain('android:widgetCategory="home_screen"')
    // Tela de bloqueio exibiria valores sem autenticação nenhuma.
    expect(info).not.toContain('keyguard')
    expect(info).toContain('android:targetCellWidth="4"')
    expect(info).toContain('android:targetCellHeight="2"')
  })

  it('a atualização periódica não é agressiva', () => {
    const info = readFileSync(
      join(NATIVE_ROOT, 'res', 'xml', 'cartero_budget_widget_info.xml'),
      'utf-8',
    )

    const match = /android:updatePeriodMillis="(\d+)"/.exec(info)
    expect(match).not.toBeNull()

    /*
      O ciclo só relê um arquivo local para envelhecer o rótulo de "atualizado
      há Xh"; não há rede envolvida. Menos de uma hora seria desperdício de
      bateria para um dado que muda quando o app sincroniza.
    */
    const millis = Number(match![1])
    expect(millis).toBeGreaterThanOrEqual(3_600_000)
  })

  it('o refresh do widget acontece DEPOIS do commit atômico', () => {
    /*
      Ordem invertida faria o launcher ler o arquivo no meio da escrita —
      exatamente a corrida que o `AtomicFile` existe para eliminar.

      A verificação olha o corpo de `write`: a gravação delega a
      `writeAtomically`, que só retorna com o conteúdo promovido, e o refresh
      vem depois DESSA chamada. Comparar posições de `finishWrite` no arquivo
      inteiro deixou de funcionar quando a escrita virou helper — e a
      propriedade que importa nunca foi a ordem textual, e sim qual chamada
      precede qual.
    */
    const module = sources.find((f) =>
      f.path.endsWith('CarteroWidgetSnapshotModule.kt'),
    )!

    const writeStart = module.text.indexOf('AsyncFunction("write")')
    expect(writeStart, 'corpo de write não encontrado').toBeGreaterThan(-1)

    // Até o início da próxima declaração — o corpo de `write` e nada além.
    const nextFn = module.text.indexOf('AsyncFunction("read")', writeStart)
    const body = module.text.slice(writeStart, nextFn)
    const commitAt = body.indexOf('writeAtomically(')
    const refreshAt = body.indexOf('requestWidgetRefresh()')

    expect(commitAt).toBeGreaterThan(-1)
    expect(refreshAt).toBeGreaterThan(commitAt)

    /*
      E o helper de fato promove antes de retornar: `finishWrite` dentro dele,
      com `failWrite` no caminho de erro.
    */
    expect(module.text).toContain('atomic.finishWrite(stream)')
    expect(module.text).toContain('atomic.failWrite(stream)')
  })

  it('a preferência de privacidade usa a MESMA escrita atômica', () => {
    /*
      Uma escrita partida que deixasse o arquivo ilegível faria a leitura cair
      no padrão — e o padrão é OCULTAR. Mesmo assim, a gravação precisa ser
      atômica: um arquivo meio escrito perderia a escolha das OUTRAS contas
      que convivem no mesmo JSON.
    */
    const module = sources.find((f) =>
      f.path.endsWith('CarteroWidgetSnapshotModule.kt'),
    )!

    expect(module.text).toContain('AsyncFunction("writePrivacy")')
    expect(module.text).toMatch(/writePrivacy[\s\S]{0,120}writeAtomically\(privacyFile\(\)/)
  })

  it('a preferência fica no mesmo diretório sem backup', () => {
    /*
      Um opt-in para revelar saldo na tela inicial não pode reaparecer sozinho
      num aparelho novo restaurado da nuvem: instalação nova começa oculta.
    */
    const module = sources.find((f) =>
      f.path.endsWith('CarteroWidgetSnapshotModule.kt'),
    )!

    expect(module.text).toContain('PRIVACY_FILE = "privacy-v1.json"')
    // A preferência resolve pelo mesmo diretório do snapshot.
    expect(module.text).toContain('File(widgetDirectory(), PRIVACY_FILE)')
    expect(module.text).toContain('noBackupFilesDir')
  })
})
