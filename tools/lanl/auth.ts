import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'

// LANL "Comprehensive, Multi-Source Cyber-Security Events" (Kent, 2015),
// authentication file. Field order as documented at csr.lanl.gov/data/cyber1/:
// "time,source user@domain,destination user@domain,source computer,
// destination computer,authentication type,logon type,authentication
// orientation,success/failure". A field with no valid value is '?'.
//
// Nothing here checks values against a list: the documentation does not give
// one, so the inventory (cli.ts) records what actually occurs.

export interface AuthRecord {
  file: string // source file name, e.g. auth.txt.gz
  line: number // 1-based line number in the decompressed file
  raw: string // the line exactly as read
  time: number // seconds from the dataset's start (epoch 1), not a clock time
  sourceUser: string | null
  destinationUser: string | null
  sourceComputer: string | null
  destinationComputer: string | null
  authType: string | null
  logonType: string | null
  orientation: string | null
  result: string | null // the documented "success/failure" field, verbatim
}

export const AUTH_FIELD_COUNT = 9

export type ParsedAuth = { ok: true; record: AuthRecord } | { ok: false; error: string }

const value = (field: string) => (field === '?' ? null : field)

export function parseAuthLine(raw: string, file: string, line: number): ParsedAuth {
  const fields = raw.split(',')
  if (fields.length !== AUTH_FIELD_COUNT) {
    return { ok: false, error: `expected ${AUTH_FIELD_COUNT} fields, got ${fields.length}` }
  }
  if (fields.some((f) => f === '')) return { ok: false, error: 'empty field' }
  // A record with no usable time cannot be placed in a case window.
  if (!/^\d+$/.test(fields[0]) || Number(fields[0]) < 1) {
    return { ok: false, error: `time "${fields[0]}" is not a whole number of seconds from 1` }
  }
  const [, su, du, sc, dc, at, lt, o, r] = fields.map(value)
  return {
    ok: true,
    record: {
      file,
      line,
      raw,
      time: Number(fields[0]),
      sourceUser: su,
      destinationUser: du,
      sourceComputer: sc,
      destinationComputer: dc,
      authType: at,
      logonType: lt,
      orientation: o,
      result: r,
    },
  }
}

export interface Line {
  line: number
  raw: string
}

// Reads a gzip file one line at a time; memory use does not grow with the
// file. A truncated or corrupt file throws, after the lines before the damage.
// `onBytes` sees the compressed bytes, for hashing while reading.
export async function* readGzipLines(
  path: string,
  onBytes?: (chunk: Buffer) => void,
): AsyncGenerator<Line> {
  const file = createReadStream(path)
  const gunzip = createGunzip()
  let failure: Error | undefined
  const fail = (err: Error) => {
    failure ??= err
    gunzip.destroy()
  }
  file.on('error', fail)
  gunzip.on('error', fail)
  if (onBytes) file.on('data', (chunk) => onBytes(chunk as Buffer))
  file.pipe(gunzip)

  const lines = createInterface({ input: gunzip, crlfDelay: Infinity })
  let line = 0
  try {
    for await (const raw of lines) {
      if (failure) break
      yield { line: ++line, raw }
    }
  } catch (err) {
    // readline may surface the gzip error itself rather than just ending.
    failure ??= err as Error
  } finally {
    lines.close()
    file.destroy()
    gunzip.destroy()
  }
  if (failure) throw new Error(`${path}: stopped after line ${line}: ${failure.message}`)
}

export function sha256Hasher() {
  const hash = createHash('sha256')
  return { update: (chunk: Buffer) => hash.update(chunk), digest: () => hash.digest('hex') }
}

export async function sha256OfFile(path: string) {
  const hash = sha256Hasher()
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) hash.update(chunk as Buffer)
  return hash.digest()
}
