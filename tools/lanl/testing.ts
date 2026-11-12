import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAuthLine, type AuthRecord } from './auth'
import { parseRedteamLine, type RedteamRecord } from './redteam'

// Test helpers: the synthetic fixtures in ./fixtures, parsed.

export const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url))

export const fixtureLines = (name: string) =>
  readFileSync(join(FIXTURES, name), 'utf8').split('\n').filter(Boolean)

export const authFixture = (): AuthRecord[] =>
  fixtureLines('SYNTHETIC-auth.txt').map((raw, i) => {
    const parsed = parseAuthLine(raw, 'SYNTHETIC-auth.txt', i + 1)
    if (!parsed.ok) throw new Error(parsed.error)
    return parsed.record
  })

export const redteamFixture = (): RedteamRecord[] =>
  fixtureLines('SYNTHETIC-redteam.txt').map((raw, i) => {
    const parsed = parseRedteamLine(raw, 'SYNTHETIC-redteam.txt', i + 1)
    if (!parsed.ok) throw new Error(parsed.error)
    return parsed.record
  })
