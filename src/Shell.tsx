import type { ReactNode } from 'react'
import { FULL_NAME, NAV } from './site'
import type { Page } from './site'

// The frame around every page: the product's name, the three places a
// visitor can go (./site.ts), and the footer.

// An open case belongs to Investigations.
const current = (page: Page) => (page === 'case' ? 'investigations' : page)

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
        <span className="mark" aria-hidden="true" />
        <span className="brand-text">
          <strong>AEMAS</strong>
          <span>by PHANG Group</span>
        </span>
      </a>
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
          <strong>AEMAS</strong> ({FULL_NAME}) by PHANG Group · Security event investigation and
          evidence verification
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
