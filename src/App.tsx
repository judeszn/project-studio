import { useEffect, useRef, useState } from 'react'
import { InferenceMode } from 'firebase/ai'
import DEMO_CASE from './data/sample-case.json?raw'
import { WORKED_EXAMPLE_TEXT } from './data/worked-example'
import { ATTACK_NOTICE, ATTACK_TERMS_URL } from './lib/attack'
import { MAX_CASE_BYTES, hasFlatRecords, parseCaseFile } from './lib/casefile'
import type { CaseSource, LoadedCase, Provenance } from './lib/casefile'
import { ai, appCheckMode, firebaseConfigured } from './lib/firebase'
import { CLOUD_TIME_LIMIT_MS, DEVICE_TIME_LIMIT_MS, guardInFlight } from './lib/attempts'
import type { Step as RunStep } from './lib/attempts'
import {
  CLOUD_DATA_TERMS,
  CLOUD_MODEL,
  GEMINI_TERMS_URL,
  LOCAL_MODE,
  NO_PROMPT_API,
  createEngine,
  failureOf,
  investigate,
  sendWithConsent,
} from './lib/hybrid'
import type { ConsentReason, Done, Engine, Request, buildModels } from './lib/hybrid'
import { authSystemPrompt, buildPrompt } from './lib/prompts'
import { buildRunRecord, readOnDeviceParams, recordFileName, sha256Hex } from './lib/record'
import type { RunFacts, RunRecord } from './lib/record'
import { buildReport, buildWorkedExample, reportFileName, reportHtml } from './lib/report'
import type { Report } from './lib/report'
import { LANL_FINDING_TYPES, lanlProposalSchema } from './lib/schema'
import type { FindingType, LogEvent } from './lib/schema'
import { verifyProposal } from './lib/verify'
import type { Verification } from './lib/verify'
import { CaseStudy } from './CaseStudy'
import { FileRefusal } from './FileRefusal'
import { Investigations } from './Investigations'
import type { Investigation } from './Investigations'
import { Overview } from './Overview'
import { ReportView } from './ReportView'
import { SiteFooter, SiteHeader } from './Shell'
import { SCREEN } from './site'
import type { Page } from './site'
import { EventList, ScreenNote } from './ui'
import './App.css'

// A case (a case file the analyst opens from disk, or the simulated sample)
// -> Gemini Nano on this device, or, only with the analyst's consent, Gemini
// in the cloud (see lib/hybrid.ts) -> incident proposal -> the same
// deterministic checks -> an investigation report and a run record the
// analyst can keep.
//
// The pages: Overview, Case Study, Investigations (where a case is opened, and
// this session's runs), and an open case in three steps (Evidence, Analysis,
// Report), each headed by one plain sentence saying what happens there. How
// the AI runs, and its status, are shown in the Analysis step and in the
// footer's system details.
// The built-in GS-03 case (src/data/gs03.ts) is no longer offered here; it
// stays as a regression fixture for its tests.

// Everything a run needs for one case. The engine is built per case, because
// the instruction and the finding types belong to the evidence.
interface ActiveCase {
  id: string
  origin: 'built-in' | 'case file' | 'demo' // built-in and demo cases are synthetic
  fileName: string | null
  sha256: string | null // of the file's bytes; the built-in case is hashed when a record is made
  source: CaseSource | null
  modelNotes: string[]
  events: LogEvent[]
  provenance: Record<string, Provenance> | null
  findingTypes: readonly FindingType[]
  systemPrompt: string
  prompt: string
  engine: Engine
  models: ReturnType<typeof buildModels>
}

// For the top bar's status and for preparing Gemini Nano before any case is
// open. It never runs an investigation.
const PROBE = createEngine(ai, authSystemPrompt([]), lanlProposalSchema)

// A case file holds authentication events, so it gets their instruction,
// finding types and response schema. The sample case is a case file too, read
// by the same loader; only its origin differs.
function openCase(
  loaded: LoadedCase,
  fileName: string,
  sha256: string,
  origin: 'case file' | 'demo' = 'case file',
): ActiveCase {
  const systemPrompt = authSystemPrompt(loaded.modelNotes)
  return {
    id: loaded.id,
    origin,
    fileName,
    sha256,
    source: loaded.source,
    modelNotes: loaded.modelNotes,
    events: loaded.events,
    provenance: loaded.provenance,
    findingTypes: LANL_FINDING_TYPES,
    systemPrompt,
    prompt: buildPrompt(loaded.events),
    ...createEngine(ai, systemPrompt, lanlProposalSchema),
  }
}

const caseTitle = (c: ActiveCase) => (c.origin === 'demo' ? 'InfoPro authentication events' : c.id)

function describe(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e)
}

type Step =
  | { state: 'idle' }
  | { state: 'working' }
  | { state: 'done' }
  | { state: 'failed'; error: string }

// Every run that ends without findings keeps its record too (record v2):
// declined, stopped by the analyst, or failed.
type Run =
  | { state: 'idle' | 'done' }
  | { state: 'working'; where: 'device' | 'cloud'; since: number } // since: Date.now()
  | { state: 'consent'; request: Request; reason: ConsentReason; detail: string }
  | { state: 'declined'; record?: RunRecord }
  | { state: 'cancelled'; message: string; record?: RunRecord }
  | { state: 'failed'; error: string; record?: RunRecord }

// A real run has a record. The worked example has none: no model ran.
interface RunResult {
  record: RunRecord | null
  report: Report
}

// A model run kept for this session, with the case it ran on.
interface Kept extends Investigation {
  record: RunRecord
  caseFile: ActiveCase
}

// When a run began, and whether the browser was online then.
interface Started {
  at: string
  online: boolean
}

const started = (): Started => ({ at: new Date().toISOString(), online: navigator.onLine })

// Saved by the browser to the analyst's disk. Nothing is uploaded.
function save(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

const download = (record: RunRecord) =>
  save(recordFileName(record), JSON.stringify(record, null, 2), 'application/json')

const exportReport = (report: Report) =>
  save(reportFileName(report), reportHtml(report, new Date().toISOString()), 'text/html')

type Tab = 'evidence' | 'analysis' | 'report'

const TABS: { id: Tab; label: string }[] = [
  { id: 'evidence', label: 'Evidence' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'report', label: 'Report' },
]

// The page an address names when the page is first loaded. A case cannot be
// reopened from its address (it lives in this page), so a case address
// starts at Investigations.
function pageFromHash(hash: string): Page {
  if (hash === '#/case-study') return 'case-study'
  if (hash === '#/investigations' || hash.startsWith('#/case/')) return 'investigations'
  return 'overview'
}

// Earlier addresses named Run and Findings; both are now Analysis.
function tabFromHash(hash: string): Tab | null {
  const match = /^#\/case\/(evidence|analysis|run|findings|report)$/.exec(hash)
  if (!match) return null
  return match[1] === 'run' || match[1] === 'findings' ? 'analysis' : (match[1] as Tab)
}

interface Status {
  label: string // in full, where there is room
  short: string // for the top bar on a phone
  tone: string
}

// What the page says about Gemini Nano, from the Prompt API's availability.
const NANO_STATUS: Record<string, Status> = {
  available: { label: 'ready', short: 'ready', tone: 'ok' },
  downloadable: { label: 'not downloaded yet', short: 'not downloaded', tone: 'warn' },
  downloading: { label: 'downloading', short: 'downloading', tone: 'warn' },
  unavailable: { label: 'not supported here', short: 'unsupported', tone: 'fail' },
}
const nanoStatus = (availability: string): Status =>
  NANO_STATUS[availability] ?? { label: availability, short: availability, tone: 'warn' }

function cloudStatus(): Status {
  if (!firebaseConfigured) return { label: 'not configured', short: 'not set up', tone: 'fail' }
  // Configured, not proven: whether Firebase accepts the token shows only
  // when a request is sent.
  if (appCheckMode === 'reCAPTCHA Enterprise')
    return { label: 'App Check configured', short: 'App Check on', tone: 'ok' }
  if (appCheckMode === 'not initialised')
    return { label: 'App Check not set up', short: 'no App Check', tone: 'fail' }
  return { label: 'development mode', short: 'dev mode', tone: 'warn' }
}

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

// An action that ignores being started again while it runs (a double click
// sends once), always running the latest version of itself.
function useGuarded<A extends unknown[]>(action: (...args: A) => Promise<void>) {
  const latest = useRef(action)
  useEffect(() => {
    latest.current = action
  })
  const [guarded] = useState(() => guardInFlight((...args: A) => latest.current(...args)))
  return guarded
}

function App() {
  const online = useOnline()
  const [active, setActive] = useState<ActiveCase | null>(null)
  const [tab, setTab] = useState<Tab>('evidence')
  const [where, setWhere] = useState<Request>('on_device')
  const [allowCloud, setAllowCloud] = useState(false)
  // Why the last file was refused, if it was.
  const [refusal, setRefusal] = useState<{ errors: string[]; flatRecords: boolean } | null>(null)
  const [availability, setAvailability] = useState('checking…')
  const [init, setInit] = useState<Step>({ state: 'idle' })
  const [progress, setProgress] = useState<number | null>(null)
  const [run, setRun] = useState<Run>({ state: 'idle' })
  const [result, setResult] = useState<RunResult | null>(null)
  // Other pages can be shown while a case stays open; the case is closed only
  // on the analyst's word.
  const [page, setPage] = useState<Page>(() => pageFromHash(location.hash))
  const fileInput = useRef<HTMLInputElement>(null)
  // The current run, step by step, for its record; and the Stop of its
  // attempt in progress.
  const steps = useRef<RunStep[]>([])
  const stopper = useRef<AbortController | null>(null)

  // The browser's back and forward move between the pages and the case's
  // steps. The address holds only the view (#/, #/investigations,
  // #/case/analysis); the case itself lives in this page, so after a reload,
  // or once it is closed, a case address shows Investigations.
  const shown: Page = page === 'case' && active === null ? 'investigations' : page
  const route =
    shown === 'case'
      ? `#/case/${tab}`
      : shown === 'case-study'
        ? '#/case-study'
        : shown === 'investigations'
          ? '#/investigations'
          : '#/'
  const hasCase = useRef(false)
  hasCase.current = active !== null
  const firstRoute = useRef(true)
  useEffect(() => {
    if ((location.hash || '#/') === route) return
    if (firstRoute.current) history.replaceState(null, '', route)
    else history.pushState(null, '', route)
  }, [route])
  useEffect(() => {
    firstRoute.current = false
    const onPop = () => {
      const caseTab = tabFromHash(location.hash)
      if (caseTab && hasCase.current) {
        setPage('case')
        setTab(caseTab)
      } else {
        const next = pageFromHash(location.hash)
        setPage(next)
        window.scrollTo(0, 0)
        const own = next === 'case-study' ? '#/case-study' : next === 'investigations' ? '#/investigations' : '#/'
        if (location.hash !== own) history.replaceState(null, '', own)
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Every model run of this session, newest first. Closing a case or running
  // again loses nothing while the page is open; it is kept in memory only, so
  // the browser asks before the page is closed or reloaded.
  const [kept, setKept] = useState<Kept[]>([])
  const unsaved = run.state === 'working' || kept.length > 0
  useEffect(() => {
    if (!unsaved) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  function navigate(next: Page) {
    const to = next === 'case' && active === null ? 'investigations' : next
    setPage(to)
    window.scrollTo(0, 0)
  }

  // Reopens a run from Investigations, on its own case, at its findings.
  function openInvestigation(id: string) {
    const k = kept.find((i) => i.id === id)
    if (!k) return
    show(k.caseFile)
    setResult({ record: k.record, report: k.report })
    setTab('analysis')
  }

  const { engine, models } = active ?? PROBE
  // The sample case is simulated. A case file is the analyst's evidence: the
  // cloud is off for it until they turn it on. Either way, every send waits
  // for their consent.
  const cloudAllowed = active !== null && (active.origin !== 'case file' || allowCloud)

  useEffect(() => {
    engine.availability().then(setAvailability)
  }, [engine])

  async function initialise() {
    if (!engine.onDeviceAdapter) {
      setInit({ state: 'failed', error: NO_PROMPT_API })
      return
    }
    setInit({ state: 'working' })
    setProgress(null)
    try {
      await models[LOCAL_MODE].initializeDeviceModel(setProgress)
      const now = await engine.availability()
      setAvailability(now)
      if (now !== 'available') throw new Error(`model is not ready: availability is "${now}"`)
      setInit({ state: 'done' })
    } catch (e) {
      setInit({ state: 'failed', error: describe(e) })
    }
  }

  // Read and checked in this page. A file that fails a check is refused and
  // the current case stays open.
  async function openFile(file: File | undefined) {
    if (!file) return
    setRefusal(null)
    if (file.size > MAX_CASE_BYTES) {
      setRefusal({ errors: [`the file is larger than ${MAX_CASE_BYTES / 1024 / 1024} MB`], flatRecords: false })
      return
    }
    const bytes = await file.arrayBuffer()
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      setRefusal({ errors: ['the file is not UTF-8 text'], flatRecords: false })
      return
    }
    const parsed = parseCaseFile(text)
    if (!parsed.ok) {
      setRefusal({ errors: parsed.errors, flatRecords: hasFlatRecords(text) })
      return
    }
    show(openCase(parsed.case, file.name, await sha256Hex(bytes)))
  }

  // The simulated sample case ships with the page and goes through the same
  // checks as a file the analyst opens.
  async function demoCase(): Promise<ActiveCase | null> {
    setRefusal(null)
    const parsed = parseCaseFile(DEMO_CASE)
    if (!parsed.ok) {
      setRefusal({ errors: parsed.errors, flatRecords: false })
      return null
    }
    return openCase(parsed.case, 'sample-case.json', await sha256Hex(DEMO_CASE), 'demo')
  }

  async function openDemo() {
    const c = await demoCase()
    if (c) show(c)
  }

  // The worked example ("How verdicts work"): the sample case, and a proposal
  // the AEMAS team wrote, checked by the same code. No model runs and no run
  // record is made.
  async function openWorkedExample() {
    const c = await demoCase()
    if (!c || !c.sha256) return
    show(c)
    const caseInfo = {
      id: c.id,
      origin: c.origin,
      fileName: c.fileName,
      sha256: c.sha256,
      events: c.events.length,
      source: c.source,
    }
    setResult({
      record: null,
      report: buildWorkedExample(caseInfo, WORKED_EXAMPLE_TEXT, c.events, c.provenance, c.findingTypes),
    })
    setTab('analysis')
  }

  // Opens a case at its evidence; closing one returns to Investigations.
  function show(next: ActiveCase | null) {
    setActive(next)
    setPage(next ? 'case' : 'investigations')
    window.scrollTo(0, 0)
    setTab('evidence')
    setWhere('on_device')
    setAllowCloud(false)
    setRefusal(null)
    setRun({ state: 'idle' })
    setResult(null)
  }

  async function recordOf(
    c: ActiveCase,
    request: Request,
    from: Started,
    outcome: RunFacts['result'],
    verification: Verification | null,
    ended?: RunFacts['ended'],
  ) {
    return buildRunRecord({
      steps: [...steps.current],
      ended,
      case: {
        id: c.id,
        origin: c.origin,
        fileName: c.fileName,
        sha256: c.sha256 ?? (await sha256Hex(JSON.stringify(c.events))),
        events: c.events.length,
        source: c.source,
      },
      systemPrompt: c.systemPrompt,
      prompt: c.prompt,
      findingTypes: c.findingTypes,
      requested: request,
      cloudAllowed,
      startedAt: from.at,
      finishedAt: new Date().toISOString(),
      onlineAtStart: from.online,
      onlineAtEnd: navigator.onLine,
      nanoAvailability: await c.engine.availability(),
      userAgent: navigator.userAgent,
      onDeviceParams: await readOnDeviceParams(),
      cloudModel: CLOUD_MODEL,
      result: outcome,
      verification,
    })
  }

  async function finish(c: ActiveCase, request: Request, done: Done, from: Started) {
    const verification = verifyProposal(done.text, c.events, c.findingTypes)
    const record = await recordOf(
      c,
      request,
      from,
      {
        text: done.text,
        inferenceSource: done.inferenceSource,
        sdkMode: done.mode,
        consented: done.consented,
        latencyMs: done.latencyMs,
      },
      verification,
    )
    const report = buildReport(record, c.events, c.provenance)
    setResult({ record, report })
    setKept((list) => [{ id: reportFileName(report), caseTitle: caseTitle(c), report, record, caseFile: c }, ...list])
    setRun({ state: 'done' })
    setTab('analysis')
  }

  // A run that gave no answer is kept as a record too, never retried elsewhere.
  async function failed(c: ActiveCase, request: Request, from: Started, error: string) {
    setRun({ state: 'failed', error, record: await recordOf(c, request, from, { error }, null) })
  }

  // Stopped by the analyst: recorded, and nothing follows.
  async function cancelled(c: ActiveCase, request: Request, from: Started, message: string) {
    const record = await recordOf(c, request, from, { error: message }, null, 'cancelled')
    setRun({ state: 'cancelled', message, record })
  }

  // The consent question on screen, answered: its step gets the decision.
  function decide(decision: 'granted' | 'declined') {
    for (const step of [...steps.current].reverse()) {
      if (step.kind === 'consent' && step.decision === null) {
        Object.assign(step, { decision, decidedAt: new Date().toISOString() })
        return
      }
    }
  }

  // When the current run began, from its first step.
  const runStart = (): Started => {
    const first = steps.current[0]
    if (first?.kind === 'attempt') return { at: first.startedAt, online: first.onlineAtStart }
    return { at: first?.askedAt ?? new Date().toISOString(), online: navigator.onLine }
  }

  // Never sends evidence off the device; at most it asks for consent, and
  // only when the cloud is allowed for this case.
  const start = useGuarded(async (request: Request) => {
    if (!active) return
    setResult(null)
    const c = active
    steps.current = []
    const stop = new AbortController()
    stopper.current = stop
    if (request === 'on_device') setRun({ state: 'working', where: 'device', since: Date.now() })
    const from = started()
    try {
      const out = await investigate(c.engine, request, c.prompt, { signal: stop.signal })
      if (out.attempt) steps.current.push(out.attempt)
      if (out.kind === 'done') await finish(c, request, out, from)
      else if (out.kind === 'ended') await cancelled(c, request, from, failureOf(out.attempt))
      else if (cloudAllowed) {
        steps.current.push({
          kind: 'consent',
          reason: out.reason,
          detail: out.detail,
          askedAt: new Date().toISOString(),
          decision: null,
          decidedAt: null,
        })
        setRun({ state: 'consent', request, reason: out.reason, detail: out.detail })
      } else await failed(c, request, from, `Nothing was sent to the cloud. ${out.detail}`)
    } catch (e) {
      await failed(c, request, from, `Nothing was sent to the cloud. ${describe(e)}`)
    } finally {
      stopper.current = null
    }
  })

  // The only path to the cloud: the analyst's click on "Send". A second click
  // while it runs is ignored, so it sends once.
  const consent = useGuarded(async (request: Request, reason: ConsentReason) => {
    if (!active || !cloudAllowed || run.state !== 'consent') return
    const c = active
    decide('granted')
    const stop = new AbortController()
    stopper.current = stop
    setRun({ state: 'working', where: 'cloud', since: Date.now() })
    const from = started()
    try {
      const out = await sendWithConsent(c.engine, reason, c.prompt, { signal: stop.signal })
      steps.current.push(out.attempt)
      if (out.kind === 'done') await finish(c, request, out, from)
      else if (out.attempt.stopReason === 'cancelled by analyst') await cancelled(c, request, from, failureOf(out.attempt))
      else await failed(c, request, from, failureOf(out.attempt))
    } catch (e) {
      await failed(c, request, from, `Cloud inference failed. ${describe(e)}`)
    } finally {
      stopper.current = null
    }
  })

  // "Keep on this device": nothing is sent, and the run's record says so.
  async function decline(request: Request) {
    if (!active || run.state !== 'consent') return
    decide('declined')
    const message = 'Nothing was sent. The investigation stays on this device.'
    setRun({ state: 'declined' })
    const record = await recordOf(active, request, runStart(), { error: message }, null, 'declined')
    setRun({ state: 'declined', record })
  }

  const busy = run.state === 'working'
  const nano = nanoStatus(availability)
  const cloud = cloudStatus()

  const fileProblems = refusal && <FileRefusal {...refusal} />

  // What the system runs on, for an analyst who needs it: folded into the
  // footer, never shown as a feature.
  const systemDetails = (
    <div className="system">
      <dl>
        <dt>On-device AI (Gemini Nano in Chrome)</dt>
        <dd className={nano.tone}>{availability}</dd>
        <dt>Cloud AI</dt>
        <dd>{CLOUD_MODEL} through Firebase AI Logic, only after your consent</dd>
        <dt>App Check (proves requests come from this app)</dt>
        <dd className={cloud.tone}>{appCheckMode}</dd>
        <dt>Firebase project</dt>
        <dd className={firebaseConfigured ? '' : 'fail'}>
          {firebaseConfigured
            ? import.meta.env.VITE_FIREBASE_PROJECT_ID
            : 'not configured; cloud calls cannot succeed'}
        </dd>
        <dt>Inference modes</dt>
        <dd>
          {LOCAL_MODE} until you consent; then {InferenceMode.PREFER_ON_DEVICE} (Nano
          unavailable) or {InferenceMode.PREFER_IN_CLOUD} (Nano failed, or cloud asked for)
        </dd>
        <dt>Network</dt>
        <dd className={online ? '' : 'warn'}>{online ? 'online' : 'offline'}</dd>
      </dl>
      {availability !== 'available' && prepare()}
    </div>
  )

  const openCaseCard = active && (
    <section className="card resume" aria-label="Open case">
      <div>
        <p className="eyebrow">Open investigation</p>
        <strong>{caseTitle(active)}</strong>
        <p className="meta">
          {busy
            ? 'Analysis running'
            : result?.record
              ? `Findings ready: ${result.report.counts.verified} of ${result.report.findings.length} verified · ${result.record.execution.model ?? 'no model'}`
              : result
                ? 'How verdicts work: worked example open'
                : 'Not analysed yet'}
        </p>
      </div>
      <div className="actions">
        <button className="primary" onClick={() => navigate('case')}>
          Resume
        </button>
        <button className="ghost" onClick={() => show(null)} disabled={busy}>
          Close case
        </button>
      </div>
    </section>
  )

  return (
    <>
      <a className="skip" href="#main" onClick={(e) => {
        e.preventDefault()
        document.getElementById('main')?.focus()
      }}>
        Skip to content
      </a>
      <SiteHeader page={shown} onNavigate={navigate} />

      <input
        ref={fileInput}
        id="case-file"
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        disabled={busy}
        onChange={(e) => {
          openFile(e.target.files?.[0])
          e.target.value = '' // so the same file can be opened again
        }}
      />

      <main id="main" className="shell" tabIndex={-1}>
        {shown === 'overview' && (
          <Overview
            notice={fileProblems}
            busy={busy}
            onStart={() => navigate('investigations')}
            onCaseStudy={() => navigate('case-study')}
            onHowVerdicts={openWorkedExample}
          />
        )}

        {shown === 'case-study' && <CaseStudy />}

        {shown === 'investigations' && (
          <Investigations
            investigations={kept}
            busy={busy}
            notice={fileProblems}
            current={openCaseCard}
            onOpenFile={() => fileInput.current?.click()}
            onSample={openDemo}
            onHowVerdicts={openWorkedExample}
            onOpen={openInvestigation}
          />
        )}

        {shown === 'case' && active && (
          <>
            <section className="casebar">
              <div>
                <p className="eyebrow">
                  <button className="link crumb" onClick={() => navigate('investigations')}>
                    Investigations
                  </button>{' '}
                  / {active.origin === 'demo' ? 'Sample evidence' : 'Case file'}
                </p>
                <h1>{caseTitle(active)}</h1>
                <p className="meta">
                  {active.events.length} events · SHA-256 {active.sha256?.slice(0, 12)}…
                  {active.origin === 'demo' && <span className="badge warn">Simulated data</span>}
                </p>
              </div>
              <button className="ghost" onClick={() => show(null)} disabled={busy}>
                Close case
              </button>
            </section>

            {active.origin === 'demo' && (
              <p className="notice warn synthetic">
                Simulated sample: authentication events invented for this demonstration. InfoPro
                has had no such incident, and no real person or system appears. It shows how the
                checks treat an AI&apos;s claims, not how well a model detects attacks.
              </p>
            )}

            <nav className="tabs" role="tablist" aria-label="Investigation steps">
              {TABS.map((t, i) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  className={tab === t.id ? 'tab active' : 'tab'}
                  onClick={() => setTab(t.id)}
                >
                  <span className="tab-step" aria-hidden="true">
                    {i + 1}
                  </span>
                  {t.label}
                  {t.id === 'analysis' && busy && (
                    <>
                      <span className="running" aria-hidden="true" />
                      <span className="visually-hidden"> (running)</span>
                    </>
                  )}
                  {t.id === 'analysis' && result && (
                    <span className="count">{result.report.findings.length}</span>
                  )}
                </button>
              ))}
            </nav>
            <ScreenNote
              text={
                tab === 'evidence'
                  ? SCREEN.evidence
                  : tab === 'report'
                    ? SCREEN.report
                    : result && !result.record
                      ? SCREEN.verdicts // the worked example: no model ran
                      : SCREEN.analysis
              }
            />

            {tab === 'evidence' && (
              <section className="card" role="tabpanel" aria-label="Evidence">
                <h2>Evidence</h2>
                <dl className="facts">
                  <dt>Case</dt>
                  <dd>{active.id}</dd>
                  <dt>File</dt>
                  <dd>{active.fileName}</dd>
                  <dt>SHA-256 of the file</dt>
                  <dd className="hash">{active.sha256}</dd>
                  <dt>Source</dt>
                  <dd>
                    {active.source?.dataset} ({active.source?.file})
                  </dd>
                  <dt>Citation</dt>
                  <dd>{active.source?.citation}</dd>
                  <dt>Instructions this file adds for the model</dt>
                  <dd>{active.modelNotes.length > 0 ? active.modelNotes.join(' ') : 'none'}</dd>
                </dl>
                <p className="hint">
                  A model is given only these event rows and the file&apos;s instructions. The
                  original records stay in this browser, beside each event.
                </p>
                <EventList
                  events={active.events.map((event) => ({
                    event,
                    provenance: active.provenance?.[event.id] ?? null,
                  }))}
                />
                <div className="actions">
                  <button className="primary" onClick={() => setTab('analysis')}>
                    Next: analyse the evidence
                  </button>
                </div>
              </section>
            )}

            {tab === 'analysis' && (
              <div role="tabpanel" aria-label="Analysis">
                {/* Findings lead once they exist; running again is the second step. */}
                {result && (
                  <ReportView
                    report={result.report}
                    showActions={false}
                    onExport={() => exportReport(result.report)}
                    onRecord={result.record ? () => download(result.record!) : undefined}
                  />
                )}
                <section className="card" aria-label="Run the analysis">
                  <h2>{result?.record ? 'Run the analysis again' : 'Run the analysis'}</h2>
                  <p className="hint">Choose where the AI runs.</p>
                  <div className="runcards" role="radiogroup" aria-label="Where the AI runs">
                    <button
                      role="radio"
                      aria-checked={where === 'on_device'}
                      className={where === 'on_device' ? 'runcard selected' : 'runcard'}
                      onClick={() => setWhere('on_device')}
                      disabled={busy}
                    >
                      <span className="runcard-head">
                        <strong>On this device</strong>
                        <span className="tag">Gemini Nano</span>
                      </span>
                      <span>
                        A small model built into Chrome, running on this computer. The evidence
                        stays here.
                      </span>
                      <span className={`state ${nano.tone}`}>Status: {nano.label}</span>
                    </button>
                    <button
                      role="radio"
                      aria-checked={where === 'in_cloud'}
                      className={where === 'in_cloud' ? 'runcard selected' : 'runcard'}
                      onClick={() => setWhere('in_cloud')}
                      disabled={busy || !cloudAllowed}
                    >
                      <span className="runcard-head">
                        <strong>In the cloud</strong>
                        <span className="tag">Gemini, Firebase AI Logic</span>
                      </span>
                      <span>
                        {CLOUD_MODEL}, a larger model in Google&apos;s cloud. You are asked before
                        anything is sent, every time.
                      </span>
                      <span className={`state ${cloudAllowed ? cloud.tone : 'warn'}`}>
                        {cloudAllowed ? `Status: ${cloud.label}` : 'Off for this case file'}
                      </span>
                    </button>
                  </div>
                  <p className="hint">
                    The two models do not perform the same: on the same case they can propose
                    different findings and a different classification. Whichever runs, code checks
                    every finding against the evidence, and the findings name the model that wrote
                    them.
                  </p>
                  {availability !== 'available' && where === 'on_device' && prepare()}
                  {active.origin === 'case file' && (
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={allowCloud}
                        disabled={busy}
                        onChange={(e) => {
                          setAllowCloud(e.target.checked)
                          if (!e.target.checked) setWhere('on_device')
                          // Turning the cloud off answers a question already on
                          // screen: declined, and recorded as such.
                          if (run.state === 'consent') void decline(run.request)
                        }}
                      />
                      Allow the cloud for this case. You are still asked before anything is sent.
                    </label>
                  )}
                  <p className="hint">
                    {cloudAllowed
                      ? 'Evidence leaves this device only if you press Send. Nothing is sent automatically.'
                      : 'The cloud is off for this case: it runs on this device or not at all. If Gemini Nano fails, the failure is recorded and nothing is sent.'}
                  </p>
                  <div className="actions">
                    <button className="primary" onClick={() => start(where)} disabled={busy}>
                      Run analysis
                    </button>
                    {!result && (
                      <button className="ghost" onClick={openWorkedExample} disabled={busy}>
                        How verdicts work
                      </button>
                    )}
                  </div>
                  {run.state === 'working' && (
                    <Working
                      where={run.where}
                      since={run.since}
                      events={active.events.length}
                      onStop={() => stopper.current?.abort()}
                    />
                  )}
                  {run.state === 'consent' && (
                    <div className="consent">
                      <p className="warn">{run.detail}</p>
                      <p>
                        Send these {active.events.length} events to {CLOUD_MODEL} through Firebase
                        AI Logic? Nothing has been sent yet.
                      </p>
                      <p className="warn">
                        {CLOUD_DATA_TERMS}{' '}
                        <a href={GEMINI_TERMS_URL} target="_blank" rel="noreferrer">
                          Gemini API terms
                        </a>
                      </p>
                      <div className="actions">
                        <button
                          className="primary"
                          onClick={() => consent(run.request, run.reason)}
                          disabled={!firebaseConfigured}
                        >
                          Send {active.events.length} events to the cloud
                        </button>
                        <button className="secondary" onClick={() => decline(run.request)}>
                          Keep on this device
                        </button>
                      </div>
                      {!firebaseConfigured && (
                        <p className="hint">The cloud needs the Firebase web app config in .env.local.</p>
                      )}
                    </div>
                  )}
                  {run.state === 'declined' && (
                    <div className="notice">
                      <p>Nothing was sent. The investigation stays on this device.</p>
                      {run.record && (
                        <button className="secondary" onClick={() => download(run.record!)}>
                          Download the record of this run
                        </button>
                      )}
                    </div>
                  )}
                  {run.state === 'cancelled' && (
                    <div className="notice warn">
                      <p>{run.message}</p>
                      {run.record && (
                        <button className="secondary" onClick={() => download(run.record!)}>
                          Download the record of this run
                        </button>
                      )}
                    </div>
                  )}
                  {run.state === 'failed' && (
                    <div className="notice fail">
                      <p>{run.error}</p>
                      {run.record && (
                        <button className="secondary" onClick={() => download(run.record!)}>
                          Download the record of this failed run
                        </button>
                      )}
                    </div>
                  )}
                </section>

              </div>
            )}

            {tab === 'report' &&
              (result ? (
                <section className="card" role="tabpanel" aria-label="Report">
                  <h2>Investigation report</h2>
                  <div className="exports">
                    <div>
                      <h3>Investigation report</h3>
                      <p className="hint">
                        One HTML file: verdicts and their reasons, the cited and uncited evidence
                        with original records, the AI&apos;s proposal marked as unverified, and how
                        it ran. Opens in any browser without a network, and prints to PDF.
                      </p>
                      <button className="primary" onClick={() => exportReport(result.report)}>
                        Export report (HTML)
                      </button>
                    </div>
                    <div>
                      <h3>Run record</h3>
                      <p className="hint">
                        {result.record
                          ? 'JSON with the prompts and their hashes, the raw model output and every check, for reproducing the run.'
                          : 'None: no model ran for the worked example, so there is no run to record.'}
                      </p>
                      {result.record && (
                        <button className="secondary" onClick={() => download(result.record!)}>
                          Download run record (JSON)
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="hint">Both files are saved to your disk and contain the evidence.</p>
                </section>
              ) : (
                <Empty onAnalyse={() => setTab('analysis')} onExample={openWorkedExample} />
              ))}
          </>
        )}
      </main>

      <SiteFooter
        system={systemDetails}
        notice={
          <>
            MITRE ATT&amp;CK® references: {ATTACK_NOTICE}{' '}
            <a href={ATTACK_TERMS_URL} target="_blank" rel="noreferrer">
              Terms of use
            </a>
            .
          </>
        }
      />
    </>
  )

  // Preparing Gemini Nano: offered where it is needed, never automatic.
  function prepare() {
    return (
      <div className="prepare">
        <p className="hint">
          Gemini Nano is {nano.label}. Chrome can download it to this computer; nothing about your
          case is sent.
        </p>
        <button className="secondary" onClick={initialise} disabled={init.state === 'working'}>
          Prepare Gemini Nano
        </button>
        {init.state === 'working' && (
          <p>
            {progress === null ? 'Preparing…' : `Downloading: ${Math.round(progress * 100)}%`}
          </p>
        )}
        {init.state === 'done' && <p className="ok">Gemini Nano is ready on this device.</p>}
        {init.state === 'failed' && <p className="fail">It could not be prepared. {init.error}</p>}
      </div>
    )
  }
}

// A run in progress. The SDK reports no progress of its own, so the page
// shows only what it knows: the stage, the time elapsed and what to expect.
// The start time lives in the run, so the clock survives a change of tab.
function Working({
  where,
  since,
  events,
  onStop,
}: {
  where: 'device' | 'cloud'
  since: number
  events: number
  onStop: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const device = where === 'device'
  return (
    <div className="working" role="status">
      <div className="working-head">
        <strong>
          {device ? 'Gemini Nano is investigating on this device' : `Waiting for ${CLOUD_MODEL}`}
        </strong>
        <span className="elapsed" role="timer" aria-live="off">
          {clock}
        </span>
      </div>
      <div className="indeterminate" aria-hidden="true">
        <span />
      </div>
      <ol className="stages">
        <li className="done">Evidence prepared: {events} events</li>
        <li className="current">
          {device
            ? 'Gemini Nano is reading the events and writing its proposal'
            : 'The cloud model is reading the events and writing its proposal'}
        </li>
        <li>Code checks each finding against the evidence</li>
      </ol>
      <p className="hint">
        {device
          ? `Nothing leaves this computer. On a laptop this can take a minute or more; you can read the evidence meanwhile. It stops by itself if its answer breaks down, or after ${DEVICE_TIME_LIMIT_MS / 60_000} minutes.`
          : `You consented to send these ${events} events; the answer comes back to this page. This page stops waiting after ${CLOUD_TIME_LIMIT_MS / 1000} seconds.`}
      </p>
      <div className="actions">
        <button className="secondary" onClick={onStop}>
          Stop
        </button>
        <span className="hint">
          {device
            ? 'Stops Gemini Nano on this computer. Nothing is sent.'
            : 'Stops this page waiting. Google may already have received the request and may still process it.'}
        </span>
      </div>
    </div>
  )
}

function Empty({ onAnalyse, onExample }: { onAnalyse: () => void; onExample: () => void }) {
  return (
    <section className="card empty" role="tabpanel" aria-label="Report">
      <h2>No report yet</h2>
      <p className="hint">
        Run the analysis to get the AI&apos;s findings, each checked against the evidence; the
        report is made from them. Or see how verdicts work on the sample evidence, with no AI
        involved.
      </p>
      <div className="actions">
        <button className="primary" onClick={onAnalyse}>
          Go to Analysis
        </button>
        <button className="secondary" onClick={onExample}>
          How verdicts work
        </button>
      </div>
    </section>
  )
}

export default App
