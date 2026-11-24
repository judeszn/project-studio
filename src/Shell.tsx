import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DESCRIPTOR, FULL_NAME, NAV } from './site'
import type { Page } from './site'

// The frame around every page: the name as a wordmark, the three places a
// visitor can go (./site.ts), the light/dark switch, and the footer.

// An open case belongs to Investigations.
const current = (page: Page) => (page === 'case' ? 'investigations' : page)

type Theme = 'light' | 'dark'

const systemTheme = (): Theme =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'

// Follows the system until the visitor chooses. The choice is held for this
// page only: nothing is written to the browser's storage.
function useTheme(): [Theme, () => void] {
  const [system, setSystem] = useState<Theme>(systemTheme)
  const [chosen, setChosen] = useState<Theme | null>(null)
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const update = () => setSystem(media.matches ? 'dark' : 'light')
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (chosen) document.documentElement.dataset.theme = chosen
    else delete document.documentElement.dataset.theme
  }, [chosen])
  const theme = chosen ?? system
  return [theme, () => setChosen(theme === 'dark' ? 'light' : 'dark')]
}

function ThemeToggle() {
  const [theme, toggle] = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        {theme === 'dark' ? (
          <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
          </g>
        ) : (
          <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  )
}

export function SiteHeader({ page, onNavigate }: { page: Page; onNavigate: (page: Page) => void }) {
  return (
    <header className="topbar">
      <a
        className="brand"
        href="#/"
        aria-label="AEMAS home"
        onClick={(e) => {
          e.preventDefault()
          onNavigate('overview')
        }}
      >
        <strong className="wordmark">AEMAS</strong>
        <span className="brand-sub">{DESCRIPTOR}</span>
      </a>
      <ThemeToggle />
      <nav className="site-nav" aria-label="Main">
        {NAV.map((item) => (
          <a
            key={item.page}
            href={item.href}
            aria-current={current(page) === item.page ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault()
              onNavigate(item.page)
            }}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  )
}

// The footer carries the attribution, the system details an analyst may need
// (folded away) and MITRE's notice.
export function SiteFooter({ system, notice }: { system: ReactNode; notice: ReactNode }) {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <p>
          <strong>AEMAS</strong> ({FULL_NAME}) by PHANG Group · {DESCRIPTOR}
        </p>
        <details className="about">
          <summary>About this system</summary>
          {system}
        </details>
        <p>{notice}</p>
      </div>
    </footer>
  )
}
