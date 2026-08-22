import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: [
        'src/common/helpers/**/*.ts',
        'src/budget/**/*.ts',
        'src/commitments/**/*.ts',
      ],
    },
  },
  resolve: {
    // O código usa imports absolutos a partir da raiz ("src/..."), resolvidos
    // em produção pelo baseUrl do tsconfig. O Vitest não lê baseUrl, então o
    // alias precisa ser explícito aqui.
    alias: {
      src: resolve(__dirname, './src'),
    },
  },
});
