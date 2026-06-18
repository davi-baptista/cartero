'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'motion/react'

export function NavigationProgress() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [width, setWidth] = useState(0)
  const prevPath = useRef(pathname)
  const rampRef = useRef<ReturnType<typeof setInterval>>(undefined)
  const hideRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  function start() {
    clearInterval(rampRef.current)
    clearTimeout(hideRef.current)
    setWidth(0)
    setVisible(true)
    let w = 0
    rampRef.current = setInterval(() => {
      w = w + (88 - w) * 0.07
      setWidth(w)
    }, 80)
  }

  function complete() {
    clearInterval(rampRef.current)
    setWidth(100)
    hideRef.current = setTimeout(() => {
      setVisible(false)
      setWidth(0)
    }, 380)
  }

  // Detect navigation start via anchor clicks
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const a = (e.target as Element).closest('a')
      if (!a) return
      const href = a.getAttribute('href')
      if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto')) return
      start()
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  // Detect navigation complete
  useEffect(() => {
    if (prevPath.current !== pathname) {
      prevPath.current = pathname
      complete()
    }
  }, [pathname])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-[2px] bg-primary"
          style={{ width: `${width}%`, transformOrigin: 'left center' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3, ease: 'easeOut' } }}
        />
      )}
    </AnimatePresence>
  )
}
