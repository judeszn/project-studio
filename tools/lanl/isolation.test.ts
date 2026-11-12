import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AUTH_VOCABULARY, toEvidence } from './case'
import { authFixture } from './testing'

// The red-team labels must never reach anything a model or a page sees.
// These tests check the import graph and the shape of built evidence.

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const HERE = fileURLToPath(new URL('.', import.meta.url))

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? filesUnder(join(dir, d.name)) : [join(dir, d.name)],
  )

const imports = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1])

describe('ground-truth isolation', () => {
  it('nothing in src/ (the page and its bundle) imports from tools/', () => {
    const offenders = filesUnder(join(REPO, 'src'))
      .filter((f) => /\.(ts|tsx|js|jsx)$/.test(f))
      .filter((f) => imports(f).some((p) => p.includes('tools/') || p.includes('lanl')))
      .map((f) => relative(REPO, f))
    expect(offenders).toEqual([])
  })

  it('evidence-building files do not import the labels or the evaluation', () => {
    for (const file of ['auth.ts', 'case.ts', 'candidates.ts', 'baseline.ts']) {
      expect(imports(join(HERE, file)).filter((p) => /redteam|evaluate/.test(p))).toEqual([])
    }
  })

  it('built evidence rows carry only the existing evidence fields', () => {
    const c = toEvidence(authFixture().slice(0, 5), AUTH_VOCABULARY)
    if (!c.ok) throw new Error(c.errors.join('; '))
    for (const e of c.events) {
      expect(Object.keys(e).sort()).toEqual(['evidence', 'provenance'])
      expect(Object.keys(e.evidence).sort()).toEqual(
        ['action', 'actor', 'date', 'detail', 'id', 'logonType', 'outcome', 'source', 'target', 'time'],
      )
      expect(Object.keys(e.provenance).sort()).toEqual(['file', 'line', 'raw'])
    }
  })
})
