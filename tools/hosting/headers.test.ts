import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The security headers Firebase Hosting sends with every response. This test
// pins the configuration; whether a deployment actually serves them is
// checked against the deployed site (see the release checks), not here.

const config = JSON.parse(readFileSync(new URL('../../firebase.json', import.meta.url), 'utf8'))
const hosting = config.hosting
const all = hosting.headers.find((h: { source: string }) => h.source === '**')
const header = (key: string): string | undefined =>
  all?.headers.find((h: { key: string }) => h.key.toLowerCase() === key.toLowerCase())?.value

const csp = () =>
  Object.fromEntries(
    (header('Content-Security-Policy') ?? '')
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((p) => p[0])
      .map(([name, ...values]) => [name, values]),
  ) as Record<string, string[]>

describe('hosting security headers', () => {
  it('forbids framing, so the consent button cannot be clickjacked', () => {
    expect(csp()['frame-ancestors']).toEqual(["'none'"])
    expect(header('X-Frame-Options')).toBe('DENY')
  })

  it('allows scripts only from this site and reCAPTCHA, with no inline or eval', () => {
    const scripts = csp()['script-src']
    expect(scripts).toEqual([
      "'self'",
      'https://www.google.com/recaptcha/',
      'https://www.gstatic.com/recaptcha/',
    ])
    expect(header('Content-Security-Policy')).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/)
  })

  // reCAPTCHA Enterprise reports from the page to www.google.com/recaptcha/
  // (found blocked on the preview channel, 2026-11-26), so it is allowed too.
  it('lets the page talk only to itself, Firebase AI Logic, App Check and reCAPTCHA', () => {
    expect(csp()['connect-src']).toEqual([
      "'self'",
      'https://firebasevertexai.googleapis.com',
      'https://content-firebaseappcheck.googleapis.com',
      'https://www.google.com/recaptcha/',
    ])
    expect(csp()['default-src']).toEqual(["'self'"])
    expect(csp()['object-src']).toEqual(["'none'"])
    expect(csp()['base-uri']).toEqual(["'none'"])
    expect(csp()['form-action']).toEqual(["'none'"])
  })

  it('sends the other standard headers', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff')
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(header('Permissions-Policy')).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/)
    expect(header('Cross-Origin-Opener-Policy')).toBe('same-origin')
  })

  it('builds and scans before every deploy', () => {
    expect(hosting.predeploy).toEqual(['npm run build', 'npm run scan:build'])
  })
})
