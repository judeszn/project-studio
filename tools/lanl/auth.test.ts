import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { parseAuthLine, readGzipLines } from './auth'
import { FIXTURES, fixtureLines } from './testing'

describe('parseAuthLine', () => {
  it('reads the nine documented fields and keeps where the line came from', () => {
    const raw = fixtureLines('SYNTHETIC-auth.txt')[0]
    expect(parseAuthLine(raw, 'auth.txt.gz', 7)).toEqual({
      ok: true,
      record: {
        file: 'auth.txt.gz',
        line: 7,
        raw,
        time: 100,
        sourceUser: 'C900001$@SYN',
        destinationUser: 'U900001@SYN',
        sourceComputer: 'C900001',
        destinationComputer: 'C900001',
        authType: 'Negotiate',
        logonType: 'Batch',
        orientation: 'LogOn',
        result: 'Success',
      },
    })
  })

  it("reads '?' as no value", () => {
    const parsed = parseAuthLine(fixtureLines('SYNTHETIC-auth.txt')[3], 'f', 4)
    expect(parsed.ok && [parsed.record.authType, parsed.record.logonType]).toEqual([null, null])
  })

  it('rejects lines it cannot read faithfully', () => {
    const bad = [
      '100,U1@D,U1@D,C1,C1,NTLM,Network,LogOn', // 8 fields
      '100,U1@D,U1@D,C1,C1,NTLM,Network,LogOn,Success,extra',
      '100,U1@D,,C1,C1,NTLM,Network,LogOn,Success', // empty, not '?'
      '?,U1@D,U1@D,C1,C1,NTLM,Network,LogOn,Success',
      '0,U1@D,U1@D,C1,C1,NTLM,Network,LogOn,Success', // epoch starts at 1
      '1.5,U1@D,U1@D,C1,C1,NTLM,Network,LogOn,Success',
    ]
    for (const raw of bad) expect(parseAuthLine(raw, 'f', 1).ok).toBe(false)
  })
})

describe('readGzipLines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lanl-test-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const gz = gzipSync(readFileSync(join(FIXTURES, 'SYNTHETIC-auth.txt')))

  it('yields every line with its 1-based line number', async () => {
    const path = join(dir, 'auth.txt.gz')
    writeFileSync(path, gz)
    const lines = []
    for await (const l of readGzipLines(path)) lines.push(l)
    expect(lines).toEqual(fixtureLines('SYNTHETIC-auth.txt').map((raw, i) => ({ line: i + 1, raw })))
  })

  it('can stop part way without error', async () => {
    const path = join(dir, 'auth.txt.gz')
    writeFileSync(path, gz)
    for await (const l of readGzipLines(path)) {
      expect(l.line).toBe(1)
      break
    }
  })

  it('throws on a truncated file instead of ending quietly', async () => {
    const path = join(dir, 'truncated.txt.gz')
    writeFileSync(path, gz.subarray(0, gz.length - 12))
    const read = async () => {
      for await (const l of readGzipLines(path)) void l
    }
    await expect(read()).rejects.toThrow(/truncated\.txt\.gz: stopped after line \d+/)
  })

  it('hashes the compressed bytes as it reads', async () => {
    const path = join(dir, 'auth.txt.gz')
    writeFileSync(path, gz)
    let bytes = 0
    for await (const l of readGzipLines(path, (chunk) => (bytes += chunk.length))) void l
    expect(bytes).toBe(gz.length)
  })
})
