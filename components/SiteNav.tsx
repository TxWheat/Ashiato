import Link from 'next/link'
import { Github } from 'lucide-react'
import { AccountButton } from './SignIn'
import { SettingsButton } from './Settings'

export default function SiteNav() {
  return (
    <nav className="flex items-center justify-between h-16 px-4 sm:px-10 border-b border-line">
      <Link href="/" className="text-[15px] font-medium tracking-[0.28em] text-fg">
        ASHIATO <span className="ml-1 tracking-normal text-faint font-normal" lang="ja">足跡</span>
      </Link>
      <div className="flex items-center gap-6 text-sm font-medium">
        <Link href="/methodology" className="hidden sm:block text-muted hover:text-fg transition-colors">
          Methodology
        </Link>
        <Link href="/pricing" className="hidden sm:block text-muted hover:text-fg transition-colors">
          Pricing
        </Link>
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
        <SettingsButton />
      </div>
    </nav>
  )
}
