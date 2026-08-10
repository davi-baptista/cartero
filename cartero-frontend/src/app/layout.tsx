import type { Metadata } from 'next'
import { Inter, Geist_Mono } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { QueryProvider } from '@/providers/query-provider'
import { AuthProvider } from '@/providers/auth-provider'
import { PwaRegister } from '@/components/pwa-register'
import './globals.css'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Cartero',
  icons: {
    icon: [
      { url: '/logo-vertical-sem-nome.png', type: 'image/png', sizes: '1024x1024' },
    ],
    shortcut: ['/logo-vertical-sem-nome.png'],
    apple: [{ url: '/logo-vertical-sem-nome.png', type: 'image/png' }],
  },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Cartero',
  },
  description: 'Gestão financeira pessoal',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${geistMono.variable} dark`}
    >
      <head>
        <link rel="icon" href="/logo-vertical-sem-nome.png" type="image/png" />
        <link rel="apple-touch-icon" href="/logo-vertical-sem-nome.png" />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <QueryProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </QueryProvider>
        <PwaRegister />
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
