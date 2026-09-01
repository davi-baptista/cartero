'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  ArrowDownUp,
  Landmark,
  Tags,
  HandCoins,
  Wallet,
  Users,
  LogOut,
  ChevronLeft,
  ChevronRight,
  PiggyBank,
  Repeat,
  CalendarClock,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useAuth } from '@/providers/auth-provider'
import { NavigationProgress } from '@/components/ui/navigation-progress'
import { MonthNav, MonthPeriodProvider, useMonthPeriod } from '@/components/month-nav'
import { SubscriptionRunner } from '@/components/subscription-runner'
import Image from 'next/image'

function SidebarNav({ pathname }: { pathname: string }) {
  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu className="gap-0.5">
            {navItems.map(({ href, label, icon: Icon }) => (
              <SidebarMenuItem key={href}>
                <SidebarMenuButton
                  render={<Link href={href} />}
                  isActive={pathname.startsWith(href)}
                  tooltip={label}
                  onClick={() => { if (isMobile) setOpenMobile(false) }}
                >
                  <Icon className="size-4" />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
  )
}

function ProfileLink({ initials, name, email }: { initials: string; name: string; email: string }) {
  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <Link
      href="/profile"
      onClick={() => { if (isMobile) setOpenMobile(false) }}
      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 py-2 transition-colors hover:bg-muted/50 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:rounded-lg group-data-[collapsible=icon]:p-2"
    >
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="bg-primary/20 text-[11px] font-semibold text-primary">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
        <p className="truncate text-[13px] font-medium leading-tight">{name}</p>
        <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">{email}</p>
      </div>
    </Link>
  )
}

function SidebarToggle() {
  const { state, toggleSidebar } = useSidebar()
  const isExpanded = state === 'expanded'
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggleSidebar}
      aria-label={isExpanded ? 'Recolher menu' : 'Expandir menu'}
      title={isExpanded ? 'Recolher menu' : 'Expandir menu'}
      className="text-muted-foreground hover:text-foreground"
    >
      {isExpanded ? (
        <ChevronLeft className="size-4" />
      ) : (
        <ChevronRight className="size-4" />
      )}
    </Button>
  )
}

/**
 * Rotas cujo conteúdo é recortado pelo mês selecionado.
 *
 * Pessoas ficava de fora porque o extrato dela abria num Sheet que cobre a
 * barra, e o drawer trazia o próprio seletor. Esse seletor foi removido — a
 * competência passou a ser da superfície que abre o drawer —, então a razão
 * da exceção deixou de existir e a página entrou no padrão das demais.
 */
const MONTH_SCOPED_ROUTES = [
  '/overview',
  '/budget',
  '/transactions',
  '/debts',
  '/receivables',
  '/persons',
]

/**
 * Rotas em que o seletor vale só no caminho EXATO.
 *
 * `/banks` é mensal: cada row mostra a fatura da competência. Já
 * `/banks/:id/invoices` lista o histórico inteiro do cartão por seção, e não
 * lê o período — um seletor ali seria um controle que não muda nada.
 */
const MONTH_SCOPED_EXACT = ['/banks']

function HeaderMonthNav({ pathname }: { pathname: string }) {
  const { period, setPeriod } = useMonthPeriod()
  const scoped =
    MONTH_SCOPED_ROUTES.some((route) => pathname.startsWith(route)) ||
    MONTH_SCOPED_EXACT.includes(pathname)
  if (!scoped) return null
  // No mobile o nome da página sai da barra, então o seletor ocupa o espaço
  // livre centralizado; no desktop ele volta a encostar à direita.
  return (
    <MonthNav
      period={period}
      onChange={setPeriod}
      compact
      className="mx-auto sm:ml-auto sm:mr-0"
    />
  )
}

const navItems = [
  { href: '/overview', label: 'Visão Geral', icon: LayoutDashboard },
  { href: '/budget', label: 'Orçamento', icon: PiggyBank },
  { href: '/transactions', label: 'Extrato', icon: ArrowDownUp },
  { href: '/subscriptions', label: 'Assinaturas', icon: Repeat },
  { href: '/commitments', label: 'Compromissos', icon: CalendarClock },
  { href: '/banks', label: 'Bancos', icon: Landmark },
  { href: '/categories', label: 'Categorias', icon: Tags },
  { href: '/debts', label: 'Dívidas', icon: HandCoins },
  { href: '/receivables', label: 'A Receber', icon: Wallet },
  { href: '/persons', label: 'Pessoas', icon: Users },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, logout, isLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login')
    }
  }, [isLoading, user, router])

  if (isLoading) {
    return (
      <div
        className="flex h-screen w-full flex-col items-center justify-center gap-5 bg-background"
        role="status"
        aria-label="Carregando"
      >
        {/* O anel orbita apenas o ícone: o logo com o nome é mais alto que
            largo, e um círculo centralizado nele cortaria a palavra. */}
        <div className="relative flex size-20 items-center justify-center">
          <svg
            className="absolute inset-0 size-full animate-spin motion-reduce:animate-none"
            style={{ animationDuration: '1.1s', animationTimingFunction: 'linear' }}
            viewBox="0 0 80 80"
            fill="none"
            aria-hidden
          >
            <circle
              cx="40" cy="40" r="38"
              stroke="currentColor"
              strokeWidth="2"
              className="text-border"
            />
            <circle
              cx="40" cy="40" r="38"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="60 179"
              className="text-primary"
            />
          </svg>
          <Image
            src="/logo-vertical-sem-nome.png"
            alt=""
            width={48}
            height={48}
            className="size-12 object-contain"
            priority
            unoptimized
          />
        </div>
        <span className="text-sm font-medium tracking-tight text-muted-foreground">
          cartero
        </span>
      </div>
    )
  }

  if (!user) return null

  const initials = user.name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()

  const currentPage = navItems.find((item) => pathname.startsWith(item.href))
  const currentPageLabel = currentPage?.label ?? (pathname === '/profile' ? 'Meu perfil' : undefined)

  return (
    <MonthPeriodProvider>
    <SidebarProvider>
      <NavigationProgress />
      <SubscriptionRunner />
      <div className="flex min-h-screen w-full">
        <Sidebar collapsible="icon">
          {/* Brand */}
          <SidebarHeader className="px-4 py-5 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-4">
            <div className="flex items-center group-data-[collapsible=icon]:justify-center">
              <Image
                src="/logo-vertical-sem-nome.png"
                alt="Cartero"
                width={28}
                height={28}
                className="size-7 shrink-0 object-contain group-data-[collapsible=icon]:block hidden"
                unoptimized
              />
              <Image
                src="/logo-horizontal.png"
                alt="Cartero"
                width={112}
                height={28}
                className="h-7 w-auto object-contain group-data-[collapsible=icon]:hidden"
                unoptimized
              />
            </div>
          </SidebarHeader>

          {/* Navigation */}
          <SidebarNav pathname={pathname} />

          {/* User */}
          <SidebarFooter className="border-t border-sidebar-border px-3 py-3 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-3">
            <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-1">
              <ProfileLink initials={initials} name={user.name} email={user.email} />
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={logout}
                aria-label="Sair"
                title="Sair"
              >
                <LogOut className="size-3.5" />
              </Button>
            </div>
          </SidebarFooter>

          <SidebarRail />
        </Sidebar>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 sm:gap-3">
            <SidebarToggle />
            <Image
              src="/logo-vertical-sem-nome.png"
              alt="Cartero"
              width={28}
              height={28}
              className="size-7 shrink-0 object-contain md:hidden"
              unoptimized
            />
            {currentPageLabel && (
              <>
                <div className="hidden h-4 w-px shrink-0 bg-border sm:block" aria-hidden />
                <span className="hidden truncate text-sm font-medium sm:block">
                  {currentPageLabel}
                </span>
              </>
            )}
            <HeaderMonthNav pathname={pathname} />
          </header>
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
    </MonthPeriodProvider>
  )
}
