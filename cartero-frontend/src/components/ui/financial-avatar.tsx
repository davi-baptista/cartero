'use client'

import type { ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ROW_ICON_BG_CLASS, ROW_ICON_CLASS } from './financial-list-row'

type AvatarTone = 'neutral' | 'income' | 'expense' | 'positive' | 'negative'

const TONE_CLASS: Record<AvatarTone, string> = {
  neutral: '',
  income: 'bg-[var(--color-income-bg)]',
  expense: '',
  positive: 'bg-paid/10',
  negative: 'bg-destructive/10',
}

const AVATAR_3D_CLASS = 'shadow-[var(--action-circle-depth)] ring-1 ring-border/50'
const ACTION_CLASS =
  'cursor-pointer outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'

type FinancialAvatarContentProps = {
  icon?: ReactNode
  tone?: AvatarTone
  disabled?: boolean
  loading?: boolean
}

export type FinancialAvatarProps = FinancialAvatarContentProps & (
  | {
      onClick: () => void
      ariaLabel: string
      title?: string
    }
  | {
      onClick?: undefined
      ariaLabel?: never
      title?: never
    }
)

/** Avatar financeiro com geometria e profundidade compartilhadas. */
export function FinancialAvatar({
  icon,
  tone = 'neutral',
  onClick,
  disabled = false,
  loading = false,
  ariaLabel,
  title,
}: FinancialAvatarProps) {
  const className = cn(
    ROW_ICON_CLASS,
    ROW_ICON_BG_CLASS,
    AVATAR_3D_CLASS,
    TONE_CLASS[tone],
    onClick && ACTION_CLASS,
  )
  const content = loading
    ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
    : icon

  if (!onClick) {
    return (
      <span className={className} aria-hidden="true">
        {content}
      </span>
    )
  }

  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      disabled={disabled || loading}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      {content}
    </button>
  )
}
