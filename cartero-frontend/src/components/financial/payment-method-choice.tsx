'use client'

import { Label } from '@/components/ui/label'
import { PAYMENT_METHODS, type PaymentMethod } from '@/lib/transaction-kind'
import { TRANSACTION_TYPE_LABELS } from '@/lib/formatters'
import { cn } from '@/lib/utils'

export function PaymentMethodChoice({ value, onChange, error, className }: { value: PaymentMethod | null; onChange: (method: PaymentMethod) => void; error?: string; className?: string }) {
  return <div className={cn('space-y-1.5', className)}>
    <Label>Forma de pagamento</Label>
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Forma de pagamento">
      {PAYMENT_METHODS.map((method) => <button key={method} type="button" aria-pressed={value === method} onClick={() => onChange(method)} className={cn('rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', value === method ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/50')}>{TRANSACTION_TYPE_LABELS[method]}</button>)}
    </div>
    {error && <p className="text-xs text-destructive">{error}</p>}
  </div>
}
