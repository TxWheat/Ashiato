'use client'

import Link from 'next/link'
import LogoMark from './LogoMark'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'
import { Github } from 'lucide-react'
import { AccountButton } from './SignIn'
import AlertsBell from './AlertsBell'
import { SettingsButton } from './Settings'

const PAGES = [
  { href: '/cases', label: 'Cases' },
  { href: '/docs', label: 'Docs' },
  { href: '/pricing', label: 'Pricing' },
]

export default function SiteNav() {
  const path = usePathname()
  return (
    <nav className="flex items-center justify-between h-16 px-4 sm:px-10 border-b border-line">
      <Link href="/" className="flex items-center gap-2.5 text-[15px] font-medium tracking-[0.28em] text-fg">
        <LogoMark size={30} />
        ASHIATO <span className="ml-1 tracking-normal text-faint font-normal" lang="ja">足跡</span>
      </Link>
      <div className="flex items-center gap-6 text-sm font-medium">
        {PAGES.map(p => (
          <Link key={p.href} href={p.href} aria-current={path === p.href ? 'page' : undefined}
            className={clsx('hidden sm:block transition-colors', path === p.href ? 'text-fg' : 'text-muted hover:text-fg')}>
            {p.label}
          </Link>
        ))}
        <a
          href="https://github.com/TxWheat/Ashiato"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-muted hover:text-fg transition-colors"
        >
          <Github size={15} />
          <span className="hidden sm:inline">Source</span>
        </a>
        <AccountButton />
        <AlertsBell />
        <SettingsButton />
      </div>
    </nav>
  )
}
