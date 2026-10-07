import {
  ArrowDownUp,
  CalendarClock,
  Landmark,
  LayoutDashboard,
  PiggyBank,
  Repeat,
  Tags,
  Users,
} from 'lucide-react'
import { isNavItemActive } from '@/lib/nav-active-route'

export const navSections = [
  {
    label: undefined,
    items: [{ href: '/overview', label: 'Visão Geral', icon: LayoutDashboard }],
  },
  {
    label: 'Operações',
    items: [
      { href: '/movements', label: 'Movimentações', icon: ArrowDownUp },
      { href: '/recurring', label: 'Recorrentes', icon: Repeat },
    ],
  },
  {
    label: 'Acompanhamento',
    items: [
      { href: '/budget', label: 'Orçamento', icon: PiggyBank },
      { href: '/commitments', label: 'Parcelas', icon: CalendarClock },
    ],
  },
  {
    label: 'Contas',
    items: [
      { href: '/banks', label: 'Bancos', icon: Landmark },
      { href: '/persons', label: 'Pessoas', icon: Users },
    ],
  },
  {
    label: 'Organização',
    items: [{ href: '/categories', label: 'Categorias', icon: Tags }],
  },
] as const

export function getNavigationGroup(pathname: string): string | undefined {
  return navSections.find((section) =>
    section.items.some((item) => isNavItemActive(item.href, pathname)),
  )?.label
}
