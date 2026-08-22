import { defineConfig } from 'vitest/config'

/**
 * Testes de LÓGICA PURA.
 *
 * Deliberadamente sem `@vitejs/plugin-react`, jsdom ou Testing Library: o que
 * precisa de proteção são as funções que decidem valores financeiros
 * (`money-semantics`, `calendar-events`, `person-statement`,
 * `settlement-status`), e todas são puras. Vitest transpila TS via esbuild sem
 * plugin adicional — e o `plugin-react` conflitaria com a árvore de babel do
 * shadcn já instalada.
 *
 * `.mts` porque o package.json não é ESM; a extensão evita o aviso do loader.
 */
export default defineConfig({
  resolve: {
    // Resolve os aliases `@/...` nativamente, sem `vite-tsconfig-paths`.
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // Sem watch por padrão: o comando precisa ser determinístico em CI.
    watch: false,
  },
})
