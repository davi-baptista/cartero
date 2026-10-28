'use client'

import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

/** Entity actions beside the title; the caller owns the existing forms and dialogs. */
export function DrawerManagementActions({
  entity,
  onEdit,
  onDelete,
}: {
  entity: 'banco' | 'pessoa'
  onEdit: () => void
  onDelete: () => void
}) {
  return <TooltipProvider>
    <div className="flex shrink-0 items-center gap-1">
      <Tooltip>
        <TooltipTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10 sm:size-8" aria-label={`Editar ${entity}`} onClick={onEdit} />}>
          <Pencil className="size-4" aria-hidden />
        </TooltipTrigger>
        <TooltipContent>Editar {entity}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10 sm:size-8" aria-label={`Excluir ${entity}`} onClick={onDelete} />}>
          <Trash2 className="size-4" aria-hidden />
        </TooltipTrigger>
        <TooltipContent>Excluir {entity}</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
}
