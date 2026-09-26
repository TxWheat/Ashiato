'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { clsx } from 'clsx'

/** Light / dark switch (shown in the Settings popover) */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  }, [])

  const apply = (t: 'dark' | 'light') => {
    setTheme(t)
    document.documentElement.dataset.theme = t
    try {
      localStorage.setItem('theme', t)
    } catch {
      // storage unavailable (private mode); theme still applies for this page
    }
  }

  return (
    <div className="grid grid-cols-2 border border-line bg-bg" role="group" aria-label="Theme">
      {(['light', 'dark'] as const).map(t => (
        <button
          key={t}
          onClick={() => apply(t)}
          aria-pressed={theme === t}
          className={clsx('flex items-center justify-center gap-1.5 h-8 text-xs capitalize transition-colors', theme === t ? 'bg-raised text-fg' : 'text-faint hover:text-fg')}
        >
          {t === 'light' ? <Sun size={13} /> : <Moon size={13} />} {t}
        </button>
      ))}
    </div>
  )
}
