import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/*
  ── Onde a credencial PODE aparecer ──

  Os testes de sessão provam comportamento: o que é gravado, o que é limpo,
  quantos refreshes acontecem. Eles não pegam uma classe inteira de regressão
  — a que não muda comportamento nenhum.

  Trocar `expo-secure-store` por `AsyncStorage` mantém todos aqueles testes
  verdes: o app loga, restaura sessão e desloga igual. O que muda é invisível
  em runtime — a credencial de 30 dias passa a ficar em texto claro no
  diretório do app, legível com root/jailbreak e capturável por backup. Um
  `console.log(token)` deixado num debug tem a mesma propriedade: nada quebra,
  e o token passa a sair no log do dispositivo.

  Esta verificação é estrutural porque a propriedade é estrutural.
*/

const SRC = join(import.meta.dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry) && !entry.endsWith('.spec.ts') ? [full] : []
  })
}

/**
 * Remove comentários antes de inspecionar.
 *
 * Sem isto, um comentário que EXPLICA por que `AsyncStorage` não é usado
 * dispararia a mesma verificação que pegaria o uso real — e a saída seria
 * apagar a explicação para satisfazer o teste, trocando documentação por
 * silêncio. A verificação é sobre o código.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const files = sourceFiles(SRC).map((path) => ({
  path,
  text: stripComments(readFileSync(path, 'utf-8')),
}))

describe('superfície da credencial no app', () => {
  it('há arquivos para inspecionar', () => {
    // Sem isto, um erro de caminho faria todos os testes abaixo passarem
    // vacuamente sobre uma lista vazia.
    expect(files.length).toBeGreaterThan(3)
  })

  /* ───────────────────────── P3 ───────────────────────── */
  it('nenhum módulo usa AsyncStorage para credencial', () => {
    const offenders = files.filter(
      ({ text }) =>
        text.includes('@react-native-async-storage') ||
        text.includes('AsyncStorage'),
    )

    expect(offenders.map((f) => f.path)).toEqual([])
  })

  it('o refresh token é gravado apenas via expo-secure-store', () => {
    const writers = files.filter(({ text }) =>
      /setRefreshToken\s*\(/.test(text) && text.includes('SecureStore'),
    )

    /*
      Um único ponto de escrita real: `secure-store.ts`. A máquina de sessão
      CHAMA `setRefreshToken`, mas através da interface — ela não conhece o
      mecanismo, que é o que permite testá-la sem runtime nativo.
    */
    expect(writers).toHaveLength(1)
    expect(writers[0].path).toMatch(/secure-store\.ts$/)
  })

  it('nenhum token é enviado a log', () => {
    const offenders = files.filter(({ text }) =>
      /console\.(log|warn|error|info|debug)\s*\([^)]*([Tt]oken|password|senha)/.test(
        text,
      ),
    )

    expect(offenders.map((f) => f.path)).toEqual([])
  })

  it('nenhum token viaja por query string ou pelo scheme de deep link', () => {
    const offenders = files.filter(
      ({ text }) =>
        /[?&](access|refresh)?[Tt]oken=/.test(text) ||
        /cartero:\/\/[^\s'"`]*token/i.test(text),
    )

    expect(offenders.map((f) => f.path)).toEqual([])
  })

  it('a senha não é persistida em lugar nenhum', () => {
    const offenders = files.filter(({ text }) =>
      /(setItemAsync|setRefreshToken|AsyncStorage\.setItem)\s*\([^)]*password/i.test(
        text,
      ),
    )

    expect(offenders.map((f) => f.path)).toEqual([])
  })

  it('o núcleo de auth não importa react-native — é o que o torna testável', () => {
    const core = files.filter(({ path }) =>
      /src[\\/](auth[\\/](session-machine|types|errors)|api[\\/]client)\.ts$/.test(
        path,
      ),
    )

    expect(core.length).toBe(4)
    for (const file of core) {
      expect(file.text).not.toMatch(/from ['"]react-native['"]/)
      expect(file.text).not.toMatch(/from ['"]expo-secure-store['"]/)
    }
  })
})
