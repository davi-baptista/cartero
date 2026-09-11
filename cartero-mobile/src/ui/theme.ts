/**
 * Fundação visual mínima — NÃO um design system.
 *
 * O Cartero Mobile deve parecer Cartero sem transcrever o web: Tailwind,
 * tokens `oklch` e as classes do shadcn não existem no React Native, e
 * reproduzi-los produziria uma camada de tradução para manter em sincronia
 * com uma superfície que não é esta.
 *
 * Só o necessário para as duas telas do M1. A identidade completa chega
 * quando houver telas que a justifiquem.
 */
export const theme = {
  color: {
    /** Fundo da aplicação — dark-first, como a identidade do Cartero. */
    background: '#0a0a0b',
    /** Superfície elevada: cartões, campos. */
    surface: '#161618',
    border: '#26262a',
    text: '#fafafa',
    textMuted: '#a1a1aa',
    primary: '#6366f1',
    primaryText: '#ffffff',
    danger: '#ef4444',
  },
  space: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  radius: {
    md: 10,
    lg: 14,
  },
  font: {
    title: 24,
    body: 16,
    small: 13,
  },
  /**
   * Altura mínima de alvo de toque.
   *
   * 48dp é o mínimo recomendado pelas diretrizes de acessibilidade das duas
   * plataformas. Vale para botão e para campo — um input de 36dp é tão
   * difícil de acertar quanto um botão de 36dp.
   */
  touchTarget: 48,
} as const
