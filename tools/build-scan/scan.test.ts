import { describe, expect, it } from 'vitest'
import { envValue, scanFile, scanName } from './scan'

// The build scan must catch a debug token in any form it can reach a build,
// allow what the Firebase SDK ships, and never print a secret.

// What the SDK's own App Check code looks like once minified: reads only.
const SDK = 'typeof c.FIREBASE_APPCHECK_DEBUG_TOKEN!="string"&&c.FIREBASE_APPCHECK_DEBUG_TOKEN;' +
  'o.token=u,typeof c.FIREBASE_APPCHECK_DEBUG_TOKEN=="string"?u.resolve(c.FIREBASE_APPCHECK_DEBUG_TOKEN):0'

const TOKEN = '3f2b9c1e-7a4d-4e8b-9c2a-1b2c3d4e5f60' // made up for this test

describe('build scan', () => {
  it('passes a clean build and the SDK’s own reads of the debug-token global', () => {
    expect(scanFile('assets/index.js', 'const a=1;' + SDK)).toEqual([])
  })

  it('catches a UUID-shaped token anywhere in a built file', () => {
    expect(scanFile('assets/index.js', `x="${TOKEN}"`)).toHaveLength(1)
    expect(scanFile('assets/index.js', `x="${TOKEN.toUpperCase()}"`)).toHaveLength(1)
  })

  it('catches the debug-token global being set, as the development code does', () => {
    const rules = (t: string) => scanFile('a.js', t).map((f) => f.rule)
    expect(rules('Object.assign(self,{FIREBASE_APPCHECK_DEBUG_TOKEN:!0})')).toContain(
      'FIREBASE_APPCHECK_DEBUG_TOKEN is set, not only read',
    )
    expect(rules('self.FIREBASE_APPCHECK_DEBUG_TOKEN=true')).toContain(
      'FIREBASE_APPCHECK_DEBUG_TOKEN is set, not only read',
    )
  })

  it('catches an inlined environment and a copied .env file', () => {
    expect(scanFile('a.js', '{VITE_APPCHECK_DEBUG_TOKEN:"x"}').map((f) => f.rule)).toContain(
      'the variable name VITE_APPCHECK_DEBUG_TOKEN (the environment was inlined)',
    )
    expect(scanName('dist/.env.local')).toHaveLength(1)
    expect(scanName('dist/assets/index.js')).toEqual([])
  })

  it('catches a local secret value without printing it', () => {
    const secret = 'not-a-uuid-but-secret-value'
    const findings = scanFile('a.js', `k="${secret}"`, [secret])
    expect(findings).toEqual([{ file: 'a.js', rule: 'a value from a local secrets file' }])
    expect(JSON.stringify(findings)).not.toContain(secret)
    expect(scanFile('a.js', 'k=""', [''])).toEqual([]) // empty values are ignored
  })

  it('reads a value from an env file, quoted or not, and ignores comments', () => {
    const env = `# comment\nVITE_OTHER=1\nVITE_APPCHECK_DEBUG_TOKEN="${TOKEN}"\n`
    expect(envValue(env, 'VITE_APPCHECK_DEBUG_TOKEN')).toBe(TOKEN)
    expect(envValue('VITE_APPCHECK_DEBUG_TOKEN=\n', 'VITE_APPCHECK_DEBUG_TOKEN')).toBeUndefined()
    expect(envValue('# VITE_APPCHECK_DEBUG_TOKEN=x', 'VITE_APPCHECK_DEBUG_TOKEN')).toBeUndefined()
  })
})
