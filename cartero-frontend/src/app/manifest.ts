import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Cartero',
    short_name: 'Cartero',
    description: 'Gestão financeira pessoal',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0b0b0c',
    theme_color: '#0b0b0c',
    lang: 'pt-BR',
    icons: [
      {
        src: '/logo-vertical-sem-nome.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/logo-vertical-sem-nome.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
