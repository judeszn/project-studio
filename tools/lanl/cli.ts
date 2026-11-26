import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { parseAuthLine, readGzipLines, sha256Hasher, sha256OfFile, type AuthRecord } from './auth'
import { runBaseline } from './baseline'
import { createScan } from './candidates'
import { AUTH_VOCABULARY, LANL_CITATION, LANL_TIME_NOTE, selectEvents, toEvidence, type CaseFile } from './case'
import type { AnyRunRecord } from '../../src/lib/record'
import { evaluate, labelCase, recordedRun, type CaseTruth } from './evaluate'
import {
  MATCH_RULES,
  matchedUser,
  parseRedteamLine,
  placeKey,
  type MatchRule,
  type RedteamRecord,
  type UserField,
} from './redteam'

// npm run lanl -- <command> [options]
//   inventory                 scan auth.txt.gz once: integrity, ordering, values
//   match                     measure how red-team lines line up with auth lines
//   candidates                the frozen selector scan (docs/SELECTOR_SPEC.md); reads no labels
//   case --id --start --end --max [--computers a,b] [--users u,v]
//   baseline --case <file>    the frozen code-only baseline on a built case; reads no labels
//   label --case <file> --rule <rule>
//   evaluate --case <file> --truth <file> --record <run record saved from the page>
//                                         (or --result <file with the model's raw output>)
//
// Raw data, cases and truth files live in the data directory (LANL_DATA_DIR,
// default ~/Data/lanl-cyber1), never in the repository.

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DATA = resolve(process.env.LANL_DATA_DIR || join(homedir(), 'Data', 'lanl-cyber1'))
const AUTH = join(DATA, 'auth.txt.gz')
const REDTEAM = join(DATA, 'redteam.txt.gz')
const INVENTORY = join(DATA, 'auth.inventory.json')

const fail = (message: string): never => {
  console.error(`lanl: ${message}`)
  process.exit(1)
}

const insideRepo = (path: string) => !relative(REPO, resolve(path)).startsWith('..')

function readable(path: string) {
  if (/\.(crdownload|part|download)$/.test(path)) fail(`${path} is an unfinished download`)
  if (!existsSync(path)) fail(`${path} not found`)
  return path
}

function write(path: string, data: unknown, { overwrite = false } = {}) {
  if (insideRepo(path)) fail(`refusing to write ${path}: it is inside the repository`)
  if (!overwrite && existsSync(path)) fail(`${path} exists; remove it first`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
  console.log(`wrote ${path}`)
}

const readJson = <T>(path: string) => JSON.parse(readFileSync(readable(path), 'utf8')) as T

interface Inventory {
  file: string
  bytes: number
  modified: string
  sha256: string
  lines: number
  malformed: number
  malformedExamples: { line: number; error: string }[]
  firstTime: number | null
  lastTime: number | null
  minTime: number | null
  maxTime: number | null
  timeDecreases: number // 0: times never go backwards, so a scan may stop early
  missing: Record<string, number> // '?' per field
  values: Record<string, Record<string, number>>
}

// Case building and matching rely on a finished, intact file. The inventory is
// written only after a full read with no gzip error, and must still describe
// the file on disk.
function requireInventory(): Inventory {
  if (!existsSync(INVENTORY)) fail(`no inventory; run "npm run lanl -- inventory" first`)
  const inv = readJson<Inventory>(INVENTORY)
  const stat = statSync(readable(AUTH))
  if (inv.bytes !== stat.size || inv.modified !== stat.mtime.toISOString()) {
    fail(`${AUTH} has changed since the inventory; run it again`)
  }
  return inv
}

async function* authRecords(path: string): AsyncGenerator<AuthRecord> {
  for await (const { line, raw } of readGzipLines(path)) {
    const parsed = parseAuthLine(raw, basename(path), line)
    if (!parsed.ok) fail(`${basename(path)} line ${line}: ${parsed.error}`)
    else yield parsed.record
  }
}

async function readRedteam(): Promise<RedteamRecord[]> {
  const records: RedteamRecord[] = []
  for await (const { line, raw } of readGzipLines(readable(REDTEAM))) {
    const parsed = parseRedteamLine(raw, basename(REDTEAM), line)
    if (!parsed.ok) fail(`${basename(REDTEAM)} line ${line}: ${parsed.error}`)
    else records.push(parsed.record)
  }
  return records
}

async function inventory() {
  const path = readable(AUTH)
  const stat = statSync(path)
  const hash = sha256Hasher()
  const fields = ['sourceUser', 'destinationUser', 'sourceComputer', 'destinationComputer', 'authType', 'logonType', 'orientation', 'result'] as const
  const counted = ['authType', 'logonType', 'orientation', 'result'] as const
  const inv: Inventory = {
    file: basename(path),
    bytes: stat.size,
    modified: stat.mtime.toISOString(),
    sha256: '',
    lines: 0,
    malformed: 0,
    malformedExamples: [],
    firstTime: null,
    lastTime: null,
    minTime: null,
    maxTime: null,
    timeDecreases: 0,
    missing: Object.fromEntries(fields.map((f) => [f, 0])),
    values: Object.fromEntries(counted.map((f) => [f, {}])),
  }
  for await (const { line, raw } of readGzipLines(path, hash.update)) {
    inv.lines = line
    if (line % 50_000_000 === 0) console.error(`… ${line.toLocaleString()} lines`)
    const parsed = parseAuthLine(raw, inv.file, line)
    if (!parsed.ok) {
      inv.malformed++
      if (inv.malformedExamples.length < 20) inv.malformedExamples.push({ line, error: parsed.error })
      continue
    }
    const r = parsed.record
    if (inv.lastTime !== null && r.time < inv.lastTime) inv.timeDecreases++
    inv.firstTime ??= r.time
    inv.lastTime = r.time
    inv.minTime = Math.min(inv.minTime ?? r.time, r.time)
    inv.maxTime = Math.max(inv.maxTime ?? r.time, r.time)
    for (const f of fields) if (r[f] === null) inv.missing[f]++
    for (const f of counted) {
      const key = r[f] ?? '?'
      const seen = inv.values[f]
      // Bounded, in case a field turns out to be free text.
      if (key in seen || Object.keys(seen).length < 1000) seen[key] = (seen[key] ?? 0) + 1
    }
  }
  inv.sha256 = hash.digest()
  write(INVENTORY, inv, { overwrite: true })
  console.log(`${inv.lines} lines, ${inv.malformed} malformed, time ${inv.minTime}–${inv.maxTime}, ${inv.timeDecreases} decreases`)
}

// Measurement only: for each red-team line, which auth lines share its time
// and computers, and for each of those whether it names the red-team user as
// source user, destination user, both, or neither. Record level, so the
// candidate rules can be compared on the records they pick, not on totals.
// The rule in use is `either_user` (owner's decision, 2026-11-11).
async function match() {
  const inv = requireInventory()
  const redteam = await readRedteam()
  const byPlace = new Map<string, RedteamRecord[]>()
  for (const red of redteam) {
    const key = placeKey(red.time, red.sourceComputer, red.destinationComputer)
    byPlace.set(key, [...(byPlace.get(key) ?? []), red])
  }
  const last = Math.max(...redteam.map((r) => r.time))
  const counts = new Map(redteam.map((r) => [r.line, { place: 0, sourceUser: 0, destinationUser: 0 }]))
  const found = new Map(redteam.map((r) => [r.line, [] as { authLine: number; user: UserField | 'neither' }[]]))
  for await (const auth of authRecords(AUTH)) {
    if (inv.timeDecreases === 0 && auth.time > last) break
    for (const red of byPlace.get(placeKey(auth.time, auth.sourceComputer, auth.destinationComputer)) ?? []) {
      const user = matchedUser(red, auth) ?? 'neither'
      const c = counts.get(red.line)!
      c.place++
      if (user === 'source' || user === 'both') c.sourceUser++
      if (user === 'destination' || user === 'both') c.destinationUser++
      found.get(red.line)!.push({ authLine: auth.line, user })
    }
  }
  const tally = (pick: (c: { place: number; sourceUser: number; destinationUser: number }) => number) => {
    const t = { none: 0, one: 0, several: 0 }
    for (const c of counts.values()) {
      const n = pick(c)
      t[n === 0 ? 'none' : n === 1 ? 'one' : 'several']++
    }
    return t
  }
  // Record level: do the source-user and destination-user rules pick the same
  // auth lines for each red-team line?
  const picked = (keep: (u: string) => boolean, line: number) =>
    found.get(line)!.filter((f) => keep(f.user)).map((f) => f.authLine).join(',')
  const differ = redteam.filter(
    (r) =>
      picked((u) => u === 'source' || u === 'both', r.line) !==
      picked((u) => u === 'destination' || u === 'both', r.line),
  ).length
  const byField = { both: 0, source: 0, destination: 0, neither: 0 }
  for (const list of found.values()) for (const f of list) byField[f.user]++
  const report = {
    redteamLines: redteam.length,
    recordLevel: {
      linesWhereSourceAndDestinationRulesPickDifferentAuthLines: differ,
      candidateAuthLinesByUserField: byField,
      labelledAuthLines: new Set(
        [...found.values()].flatMap((l) => l.filter((f) => f.user !== 'neither').map((f) => f.authLine)),
      ).size,
      unmatchedRedteamLines: redteam.filter((r) => !found.get(r.line)!.some((f) => f.user !== 'neither')).map((r) => r.line),
    },
    authFile: { file: inv.file, sha256: inv.sha256 },
    // Red-team lines by the number of auth lines that agree on:
    timeAndComputers: tally((c) => c.place),
    plusSourceUser: tally((c) => c.sourceUser),
    plusDestinationUser: tally((c) => c.destinationUser),
    perLine: [...counts].map(([line, c]) => ({ line, ...c, auth: found.get(line)! })),
  }
  write(join(DATA, 'redteam-match.json'), report, { overwrite: true })
  console.log(JSON.stringify({ ...report, perLine: undefined }, null, 2))
}

// The candidate scan of docs/SELECTOR_SPEC.md: one pass over the whole
// authentication file, by the frozen rule, with no option to change it. It
// does not read the red-team file. The scan is run once: an existing result
// is never overwritten.
async function candidates() {
  const inv = requireInventory()
  const out = join(DATA, 'candidates.json')
  if (existsSync(out)) fail(`${out} exists; the scan is run once and its result is kept`)
  const started = Date.now()
  const minutes = (since: number) => ((Date.now() - since) / 60_000).toFixed(1)
  if ((await sha256OfFile(AUTH)) !== inv.sha256) fail(`${AUTH} does not have the inventory's sha256; not scanning`)
  const scanStarted = Date.now()
  console.error(`sha256 matches the inventory (${minutes(started)} min); scanning`)

  const hash = sha256Hasher()
  const scan = createScan()
  const mib = (bytes: number) => Math.round(bytes / 2 ** 20)
  let peakRss = 0
  let lines = 0
  for await (const { line, raw } of readGzipLines(AUTH, hash.update)) {
    const parsed = parseAuthLine(raw, inv.file, line)
    if (!parsed.ok) fail(`${inv.file} line ${line}: ${parsed.error}`)
    else scan.add(parsed.record)
    lines = line
    if (line % 1_000_000 === 0) peakRss = Math.max(peakRss, process.memoryUsage.rss())
    if (line % 50_000_000 === 0) {
      console.error(
        `… ${line.toLocaleString()} lines, ${minutes(scanStarted)} min, ${scan.pairs.toLocaleString()} pairs, ${mib(process.memoryUsage.rss())} MiB`,
      )
    }
  }
  // What was scanned must be what the inventory describes.
  if (hash.digest() !== inv.sha256) fail('the bytes scanned do not have the inventory\'s sha256; no result written')
  if (lines !== inv.lines) fail(`scanned ${lines} lines, the inventory has ${inv.lines}; no result written`)
  const result = scan.finish()
  peakRss = Math.max(peakRss, process.memoryUsage.rss())
  const cpu = process.cpuUsage()
  const report = {
    specification: 'docs/SELECTOR_SPEC.md',
    generated: new Date().toISOString(),
    authFile: { file: inv.file, sha256: inv.sha256, lines },
    ...result,
    resources: {
      hashSeconds: Math.round((scanStarted - started) / 1000),
      scanSeconds: Math.round((Date.now() - scanStarted) / 1000),
      cpuSeconds: Math.round((cpu.user + cpu.system) / 1e6),
      peakRssMiB: mib(peakRss),
    },
  }
  write(out, report)
  console.log(JSON.stringify(report, null, 2))
}

const list = (v: string | undefined) => (v ? v.split(',').filter(Boolean) : [])
const num = (name: string, v: string | undefined) =>
  v !== undefined && /^\d+$/.test(v) ? Number(v) : fail(`--${name} must be a whole number`)

async function buildCase(o: Record<string, string | undefined>) {
  const inv = requireInventory()
  if (!o.id || !/^[\w-]+$/.test(o.id)) fail('--id is required (letters, digits, - and _)')
  const spec = {
    id: o.id!,
    start: num('start', o.start),
    end: num('end', o.end),
    computers: list(o.computers),
    users: list(o.users),
    maxEvents: num('max', o.max),
  }
  const out = join(DATA, 'cases', `${spec.id}.json`)
  if (existsSync(out)) fail(`${out} exists; remove it first`)
  if ((await sha256OfFile(AUTH)) !== inv.sha256) fail(`${AUTH} does not have the inventory's sha256; no case built`)
  const selection = await selectEvents(authRecords(AUTH), spec, { sorted: inv.timeDecreases === 0 })
  if (!selection.ok) fail(selection.error)
  else {
    const conversion = toEvidence(selection.records, AUTH_VOCABULARY)
    if (!conversion.ok) fail(`cannot convert:\n  ${conversion.errors.join('\n  ')}`)
    else {
      const caseFile: CaseFile = {
        spec,
        source: {
          dataset: 'LANL Comprehensive, Multi-Source Cyber-Security Events',
          citation: LANL_CITATION,
          file: inv.file,
          sha256: inv.sha256,
        },
        modelNotes: [LANL_TIME_NOTE],
        events: conversion.events,
      }
      write(out, caseFile)
      console.log(`${caseFile.events.length} events after scanning ${selection.scanned} lines`)
    }
  }
}

async function baseline(o: Record<string, string | undefined>) {
  const inv = requireInventory()
  const caseFile = readJson<CaseFile>(o.case ?? fail('--case is required'))
  const out = join(DATA, 'baseline', `${caseFile.spec.id}.baseline.json`)
  if (existsSync(out)) fail(`${out} exists; the baseline is run once and its result is kept`)
  if (caseFile.source.sha256 !== inv.sha256) fail('the case was not built from the inventoried file')
  if ((await sha256OfFile(AUTH)) !== inv.sha256) fail(`${AUTH} does not have the inventory's sha256; not running`)
  const parse = (raw: string, file: string, line: number) => {
    const parsed = parseAuthLine(raw, file, line)
    return parsed.ok ? parsed.record : fail(`${file} line ${line}: ${parsed.error}`)
  }
  const result = await runBaseline(caseFile, authRecords(AUTH), parse)
  write(out, { generated: new Date().toISOString(), authFile: { file: inv.file, sha256: inv.sha256 }, ...result })
  console.log(`${result.flagged.length} of ${result.events} events flagged after scanning ${result.scannedLines} lines`)
}

async function label(o: Record<string, string | undefined>) {
  const rule = o.rule as MatchRule
  if (!MATCH_RULES.includes(rule)) fail(`--rule must be one of ${MATCH_RULES.join(', ')}`)
  const caseFile = readJson<CaseFile>(o.case ?? fail('--case is required'))
  const truth = labelCase(caseFile, await readRedteam(), rule, basename(REDTEAM))
  write(join(DATA, 'truth', `${caseFile.spec.id}.truth.json`), truth)
  console.log(`${truth.labelled.length} of ${caseFile.events.length} events labelled under ${rule}`)
}

async function evaluateCase(o: Record<string, string | undefined>) {
  const casePath = o.case ?? fail('--case is required')
  const caseFile = readJson<CaseFile>(casePath)
  const truth = readJson<CaseTruth>(o.truth ?? fail('--truth is required'))
  if (o.record) {
    // A run record saved from the page: checked against the case first.
    const run = await recordedRun(readJson<AnyRunRecord>(o.record), caseFile, await sha256OfFile(casePath)).catch(
      (e: Error) => fail(e.message),
    )
    const { raw, ...where } = run
    console.log(JSON.stringify({ run: where, ...evaluate(caseFile, truth, raw) }, null, 2))
    return
  }
  const raw = readFileSync(readable(o.result ?? fail('--record or --result is required')), 'utf8')
  console.log(JSON.stringify(evaluate(caseFile, truth, raw), null, 2))
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: Object.fromEntries(
    ['id', 'start', 'end', 'computers', 'users', 'max', 'case', 'rule', 'truth', 'result', 'record'].map((k) => [
      k,
      { type: 'string' as const },
    ]),
  ),
})

const commands: Record<string, () => unknown> = {
  inventory,
  match,
  candidates,
  case: () => buildCase(values),
  baseline: () => baseline(values),
  label: () => label(values),
  evaluate: () => evaluateCase(values),
}
const run = commands[positionals[0]] ?? (() => fail(`usage: npm run lanl -- ${Object.keys(commands).join('|')} [options]`))
await run()
