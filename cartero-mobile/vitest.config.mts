import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/*
  Testes de LÓGICA, sem renderizar React Native.

  O mesmo recorte que o frontend web já usa: o que precisa de proteção aqui é
  a máquina de sessão, o armazenamento da credencial e a coordenação de
  refresh — todas funções puras ou injetáveis. Montar o runtime do RN para
  exercitá-las acrescentaria uma dependência frágil (jsdom, transformer de
  Flow, mocks de módulo nativo) sem cobrir nenhum comportamento a mais.

  Por isso o núcleo de auth NÃO importa nada de `react-native`: ele recebe o
  armazenamento seguro e o cliente HTTP como dependências. É essa escolha que
  torna o teste possível — e ela é verificada por um teste próprio.
*/
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
})
