import type { LucideIcon } from 'lucide-react'
import {
  UtensilsCrossed, Coffee, Pizza, Wine, Beer, Beef,
  Car, Bus, Train, Plane, Bike, Truck,
  ShoppingCart, ShoppingBag, Package, Store, Tag,
  Heart, Activity, Pill, Stethoscope, Dumbbell,
  Gamepad2, Music, Film, Tv, Headphones, Trophy,
  Home, Building2, Wrench, Hammer, Sofa,
  Wallet, TrendingUp, PiggyBank, DollarSign, Receipt, CreditCard, BarChart2, Banknote,
  GraduationCap, BookOpen, PenLine,
  Globe, Map, Compass, MapPin, Camera,
  Zap, Droplets, Wifi, Flame, Lightbulb, Phone,
  PawPrint, Shirt, Scissors, Sparkles, Briefcase, Laptop, Monitor, Building,
} from 'lucide-react'

export interface CategoryIconDef {
  name: string
  Icon: LucideIcon
  label: string
}

export interface CategoryIconGroup {
  label: string
  icons: CategoryIconDef[]
}

export const DEFAULT_CATEGORY_ICON = 'Tag'

export const CATEGORY_ICON_GROUPS: CategoryIconGroup[] = [
  {
    label: 'Alimentação',
    icons: [
      { name: 'UtensilsCrossed', Icon: UtensilsCrossed, label: 'Restaurante' },
      { name: 'Coffee', Icon: Coffee, label: 'Café' },
      { name: 'Pizza', Icon: Pizza, label: 'Pizza' },
      { name: 'Wine', Icon: Wine, label: 'Vinho' },
      { name: 'Beer', Icon: Beer, label: 'Cerveja' },
      { name: 'Beef', Icon: Beef, label: 'Carne' },
    ],
  },
  {
    label: 'Transporte',
    icons: [
      { name: 'Car', Icon: Car, label: 'Carro' },
      { name: 'Bus', Icon: Bus, label: 'Ônibus' },
      { name: 'Train', Icon: Train, label: 'Trem' },
      { name: 'Plane', Icon: Plane, label: 'Avião' },
      { name: 'Bike', Icon: Bike, label: 'Bicicleta' },
      { name: 'Truck', Icon: Truck, label: 'Caminhão' },
    ],
  },
  {
    label: 'Compras',
    icons: [
      { name: 'ShoppingCart', Icon: ShoppingCart, label: 'Compras' },
      { name: 'ShoppingBag', Icon: ShoppingBag, label: 'Sacola' },
      { name: 'Package', Icon: Package, label: 'Encomenda' },
      { name: 'Store', Icon: Store, label: 'Loja' },
      { name: 'Tag', Icon: Tag, label: 'Etiqueta' },
    ],
  },
  {
    label: 'Saúde',
    icons: [
      { name: 'Heart', Icon: Heart, label: 'Saúde' },
      { name: 'Activity', Icon: Activity, label: 'Atividade' },
      { name: 'Pill', Icon: Pill, label: 'Remédio' },
      { name: 'Stethoscope', Icon: Stethoscope, label: 'Médico' },
      { name: 'Dumbbell', Icon: Dumbbell, label: 'Academia' },
    ],
  },
  {
    label: 'Lazer',
    icons: [
      { name: 'Gamepad2', Icon: Gamepad2, label: 'Jogos' },
      { name: 'Music', Icon: Music, label: 'Música' },
      { name: 'Film', Icon: Film, label: 'Cinema' },
      { name: 'Tv', Icon: Tv, label: 'TV' },
      { name: 'Headphones', Icon: Headphones, label: 'Fones' },
      { name: 'Trophy', Icon: Trophy, label: 'Troféu' },
    ],
  },
  {
    label: 'Casa',
    icons: [
      { name: 'Home', Icon: Home, label: 'Casa' },
      { name: 'Building2', Icon: Building2, label: 'Condomínio' },
      { name: 'Wrench', Icon: Wrench, label: 'Manutenção' },
      { name: 'Hammer', Icon: Hammer, label: 'Obras' },
      { name: 'Sofa', Icon: Sofa, label: 'Móveis' },
    ],
  },
  {
    label: 'Finanças',
    icons: [
      { name: 'Wallet', Icon: Wallet, label: 'Carteira' },
      { name: 'TrendingUp', Icon: TrendingUp, label: 'Investimento' },
      { name: 'PiggyBank', Icon: PiggyBank, label: 'Poupança' },
      { name: 'DollarSign', Icon: DollarSign, label: 'Dinheiro' },
      { name: 'Receipt', Icon: Receipt, label: 'Comprovante' },
      { name: 'CreditCard', Icon: CreditCard, label: 'Crédito' },
      { name: 'BarChart2', Icon: BarChart2, label: 'Gráfico' },
      { name: 'Banknote', Icon: Banknote, label: 'Nota' },
    ],
  },
  {
    label: 'Educação',
    icons: [
      { name: 'GraduationCap', Icon: GraduationCap, label: 'Faculdade' },
      { name: 'BookOpen', Icon: BookOpen, label: 'Estudo' },
      { name: 'PenLine', Icon: PenLine, label: 'Escrita' },
    ],
  },
  {
    label: 'Viagem',
    icons: [
      { name: 'Globe', Icon: Globe, label: 'Mundo' },
      { name: 'Map', Icon: Map, label: 'Mapa' },
      { name: 'Compass', Icon: Compass, label: 'Bússola' },
      { name: 'MapPin', Icon: MapPin, label: 'Local' },
      { name: 'Camera', Icon: Camera, label: 'Câmera' },
    ],
  },
  {
    label: 'Utilidades',
    icons: [
      { name: 'Zap', Icon: Zap, label: 'Luz' },
      { name: 'Droplets', Icon: Droplets, label: 'Água' },
      { name: 'Wifi', Icon: Wifi, label: 'Internet' },
      { name: 'Flame', Icon: Flame, label: 'Gás' },
      { name: 'Lightbulb', Icon: Lightbulb, label: 'Energia' },
      { name: 'Phone', Icon: Phone, label: 'Telefone' },
    ],
  },
  {
    label: 'Outros',
    icons: [
      { name: 'PawPrint', Icon: PawPrint, label: 'Pet' },
      { name: 'Shirt', Icon: Shirt, label: 'Roupa' },
      { name: 'Scissors', Icon: Scissors, label: 'Estética' },
      { name: 'Sparkles', Icon: Sparkles, label: 'Beleza' },
      { name: 'Briefcase', Icon: Briefcase, label: 'Trabalho' },
      { name: 'Laptop', Icon: Laptop, label: 'Notebook' },
      { name: 'Monitor', Icon: Monitor, label: 'Computador' },
      { name: 'Building', Icon: Building, label: 'Empresa' },
    ],
  },
]

export const CATEGORY_ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  CATEGORY_ICON_GROUPS.flatMap((g) => g.icons.map(({ name, Icon }) => [name, Icon])),
)

export function resolveCategoryIcon(icon?: string | null) {
  const iconName = icon && CATEGORY_ICON_MAP[icon] ? icon : DEFAULT_CATEGORY_ICON
  return {
    iconName,
    Icon: CATEGORY_ICON_MAP[iconName],
  }
}
