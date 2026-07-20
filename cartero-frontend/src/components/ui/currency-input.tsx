'use client'

import { forwardRef } from 'react'
import { Input } from '@/components/ui/input'

interface CurrencyInputProps {
  value: number
  onChange: (value: number) => void
  id?: string
  placeholder?: string
  className?: string
  disabled?: boolean
  'aria-invalid'?: boolean
}

function formatCents(cents: number): string {
  const clamped = Math.max(0, cents)
  const reais = Math.floor(clamped / 100)
  const centavos = clamped % 100
  return `${reais.toLocaleString('pt-BR')},${String(centavos).padStart(2, '0')}`
}

export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  function CurrencyInput({ value, onChange, ...props }, ref) {
    const cents = Math.round(value * 100)

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const digits = e.target.value.replace(/\D/g, '')
      const nextCents = digits === '' ? 0 : Number(digits)
      onChange(nextCents / 100)
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      if (e.key === 'Backspace') {
        e.preventDefault()
        const nextCents = Math.floor(cents / 10)
        onChange(nextCents / 100)
      } else if (e.key === 'Delete') {
        e.preventDefault()
        onChange(0)
      }
    }

    return (
      <Input
        ref={ref}
        inputMode="numeric"
        value={formatCents(cents)}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        {...props}
      />
    )
  },
)
