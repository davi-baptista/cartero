'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ArrowDownUp,
  Landmark,
  Tags,
  HandCoins,
  Wallet,
  LogOut,
  ChevronLeft,
  ChevronRight,
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
import { Skeleton } from '@/components/ui/skeleton'
import { NavigationProgress } from '@/components/ui/navigation-progress'

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

const navItems = [
  { href: '/transactions', label: 'Transações', icon: ArrowDownUp },
  { href: '/banks', label: 'Bancos', icon: Landmark },
  { href: '/categories', label: 'Categorias', icon: Tags },
  { href: '/debts', label: 'Dívidas', icon: HandCoins },
  { href: '/receivables', label: 'A Receber', icon: Wallet },
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
      <div className="flex h-screen w-full bg-background">
        {/* Sidebar skeleton */}
        <div className="flex w-[14rem] shrink-0 flex-col border-r border-border bg-sidebar px-4 py-5">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-7 rounded-lg" />
            <Skeleton className="h-4 w-20" />
          </div>
          {/* Nav items */}
          <div className="mt-6 flex flex-col gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-md" />
            ))}
          </div>
          {/* Footer */}
          <div className="mt-auto flex items-center gap-3 pt-4 border-t border-sidebar-border">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex flex-col gap-1.5 flex-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-2.5 w-32" />
            </div>
          </div>
        </div>
        {/* Content skeleton */}
        <div className="flex flex-1 flex-col">
          {/* Header */}
          <div className="flex h-14 items-center gap-3 border-b border-border px-4">
            <Skeleton className="size-7 rounded-md" />
            <Skeleton className="h-px w-px" />
            <Skeleton className="h-4 w-24" />
          </div>
          {/* Page content */}
          <div className="flex flex-col gap-6 p-6">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-7 w-36" />
                <Skeleton className="h-4 w-52" />
              </div>
              <Skeleton className="h-9 w-28 rounded-md" />
            </div>
            <div className="flex flex-col gap-px">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-none first:rounded-t-md last:rounded-b-md" />
              ))}
            </div>
          </div>
        </div>
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

  return (
    <SidebarProvider>
      <NavigationProgress />
      <div className="flex min-h-screen w-full">
        <Sidebar collapsible="icon">
          {/* Brand */}
          <SidebarHeader className="px-4 py-5 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-4">
            <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:justify-center">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-[11px] font-bold text-primary-foreground select-none">
                C
              </div>
              <span className="text-[15px] font-semibold tracking-tight group-data-[collapsible=icon]:hidden">Cartero</span>
            </div>
          </SidebarHeader>

          {/* Navigation */}
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

          {/* User */}
          <SidebarFooter className="border-t border-sidebar-border px-3 py-3 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-3">
            <div className="flex items-center gap-3 rounded-lg px-1.5 py-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
              <Avatar className="size-8 shrink-0">
                <AvatarFallback className="bg-primary/20 text-[11px] font-semibold text-primary">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                <p className="truncate text-[13px] font-medium leading-tight">{user.name}</p>
                <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">{user.email}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground hover:text-destructive group-data-[collapsible=icon]:hidden"
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
          <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
            <SidebarToggle />
            {currentPage && (
              <>
                <div className="h-4 w-px bg-border" aria-hidden />
                <span className="text-sm font-medium">{currentPage.label}</span>
              </>
            )}
          </header>
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  )
}
