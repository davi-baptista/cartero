'use client'

import { motion } from 'motion/react'
import { cn } from '@/lib/utils'

interface MotionRowProps {
  index: number
  className?: string
  children: React.ReactNode
}

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const

export function MotionRow({ index, className, children }: MotionRowProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.24,
        ease: EASE_OUT_EXPO,
        delay: Math.min(index, 12) * 0.04,
      }}
      className={cn('border-b border-border last:border-b-0', className)}
    >
      {children}
    </motion.div>
  )
}
