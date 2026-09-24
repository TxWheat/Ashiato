'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { clsx } from 'clsx'

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
    <div className="flex border border-line bg-panel">
      {(['light', 'dark'] as const).map(t => (
        <button
          key={t}
          onClick={() => apply(t)}
          aria-label={`${t} theme`}
          className={clsx('p-2 transition-colors', theme === t ? 'bg-raised text-fg' : 'text-faint hover:text-fg')}
        >
          {t === 'light' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      ))}
    </div>
  )
}
