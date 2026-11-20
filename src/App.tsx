import { useEffect, useRef, useState } from 'react'
import { InferenceMode } from 'firebase/ai'
import DEMO_CASE from './data/sample-case.json?raw'
import { WORKED_EXAMPLE_TEXT } from './data/worked-example'
import { ATTACK_NOTICE, ATTACK_TERMS_URL } from './lib/attack'
import { MAX_CASE_BYTES, parseCaseFile } from './lib/casefile'
import type { CaseSource, LoadedCase, Provenance } from './lib/casefile'
import { ai, appCheckMode, firebaseConfigured } from './lib/firebase'
import {
  CLOUD_DATA_TERMS,
  CLOUD_MODEL,
  GEMINI_TERMS_URL,
  LOCAL_MODE,
  NO_PROMPT_API,
  createEngine,
  investigate,
  sendWithConsent,
} from './lib/hybrid'
import type { ConsentReason, Done, Engine, Request, buildModels } from './lib/hybrid'
import { authSystemPrompt, buildPrompt } from './lib/prompts'
import { buildRunRecord, readOnDeviceParams, recordFileName, sha256Hex } from './lib/record'
import type { RunFacts, RunRecord } from './lib/record'
import {
  VERDICTS,
  VERDICT_LABEL,
  buildReport,
  buildWorkedExample,
  reportFileName,
  reportHtml,
} from './lib/report'
import type { Report } from './lib/report'
import { LANL_FINDING_TYPES, lanlProposalSchema } from './lib/schema'
import type { FindingType, LogEvent } from './lib/schema'
import { verifyProposal } from './lib/verify'
import type { Verification } from './lib/verify'
import { Dashboard } from './Dashboard'
import type { Investigation } from './Dashboard'
import { ReportView } from './ReportView'
import { EventList } from './ui'
import './App.css'

// A case (a case file the analyst opens from disk, or the simulated sample)
// -> Gemini Nano on this device, or, only with the analyst's consent, Gemini
// in the cloud (see lib/hybrid.ts) -> incident proposal -> the same
// deterministic checks -> an investigation report and a run record the
// analyst can keep.
//
// The page: a top bar with the AI's status, a landing view when no case is
// open, and a case workspace in four tabs (Evidence, Run, Findings, Report).
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

type Run =
  | { state: 'idle' | 'done' | 'declined' }
  | { state: 'working'; where: 'device' | 'cloud'; since: number } // since: Date.now()
  | { state: 'consent'; request: Request; reason: ConsentReason; detail: string }
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

type Tab = 'evidence' | 'run' | 'findings' | 'report'

const TABS: { id: Tab; label: string }[] = [
  { id: 'evidence', label: 'Evidence' },
  { id: 'run', label: 'Run' },
  { id: 'findings', label: 'Findings' },
  { id: 'report', label: 'Report' },
]

// The landing page's preview: the worked example's verdicts, from the same
// checks the example runs, so the numbers shown are the ones it produces.
const PREVIEW: Report | null = (() => {
  const parsed = parseCaseFile(DEMO_CASE)
  if (!parsed.ok) return null
  const c = parsed.case
  const caseInfo = {
    id: c.id,
    origin: 'demo' as const,
    fileName: 'sample-case.json',
    sha256: '', // not shown; the example itself hashes the file
    events: c.events.length,
    source: c.source,
  }
  return buildWorkedExample(caseInfo, WORKED_EXAMPLE_TEXT, c.events, c.provenance, LANL_FINDING_TYPES)
})()

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

function App() {
  const online = useOnline()
  const [active, setActive] = useState<ActiveCase | null>(null)
  const [tab, setTab] = useState<Tab>('evidence')
  const [where, setWhere] = useState<Request>('on_device')
  const [showSystem, setShowSystem] = useState(false)
  const [allowCloud, setAllowCloud] = useState(false)
  const [fileErrors, setFileErrors] = useState<string[]>([])
  const [availability, setAvailability] = useState('checking…')
  const [init, setInit] = useState<Step>({ state: 'idle' })
  const [progress, setProgress] = useState<number | null>(null)
  const [run, setRun] = useState<Run>({ state: 'idle' })
  const [result, setResult] = useState<RunResult | null>(null)
  // Home can be shown while a case stays open; the case is closed only on
  // the analyst's word.
  const [atHome, setAtHome] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // The browser's back and forward move between home and the case's tabs.
  // The address holds only the view (#/, #/case/findings); the case itself
  // lives in this page, so after a reload, or once it is closed, a case
  // address shows home.
  const route = active === null || atHome ? '#/' : `#/case/${tab}`
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
      const match = /^#\/case\/(evidence|run|findings|report)$/.exec(location.hash)
      if (match && hasCase.current) {
        setAtHome(false)
        setTab(match[1] as Tab)
      } else {
        setAtHome(true)
        if (location.hash !== '#/') history.replaceState(null, '', '#/')
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

  function goHome() {
    setAtHome(true)
    window.scrollTo(0, 0)
  }

  // Reopens a run from the overview, on its own case, at its findings.
  function openInvestigation(id: string) {
    const k = kept.find((i) => i.id === id)
    if (!k) return
    show(k.caseFile)
    setResult({ record: k.record, report: k.report })
    setTab('findings')
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
    setFileErrors([])
    if (file.size > MAX_CASE_BYTES) {
      setFileErrors([`the file is larger than ${MAX_CASE_BYTES / 1024 / 1024} MB`])
      return
    }
    const bytes = await file.arrayBuffer()
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      setFileErrors(['the file is not UTF-8 text'])
      return
    }
    const parsed = parseCaseFile(text)
    if (!parsed.ok) {
      setFileErrors(parsed.errors)
      return
    }
    show(openCase(parsed.case, file.name, await sha256Hex(bytes)))
  }

  // The simulated sample case ships with the page and goes through the same
  // checks as a file the analyst opens.
  async function demoCase(): Promise<ActiveCase | null> {
    setFileErrors([])
    const parsed = parseCaseFile(DEMO_CASE)
    if (!parsed.ok) {
      setFileErrors(parsed.errors)
      return null
    }
    return openCase(parsed.case, 'sample-case.json', await sha256Hex(DEMO_CASE), 'demo')
  }

  async function openDemo() {
    const c = await demoCase()
    if (c) show(c)
  }

  // The worked example: the sample case, and a proposal the Project Studio
  // team wrote, checked by the same code. No model runs and no run record is
  // made.
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
    setTab('findings')
  }

  function show(next: ActiveCase | null) {
    setActive(next)
    setAtHome(false)
    setTab('evidence')
    setWhere('on_device')
    setAllowCloud(false)
    setFileErrors([])
    setRun({ state: 'idle' })
    setResult(null)
  }

  async function recordOf(
    c: ActiveCase,
    request: Request,
    from: Started,
    outcome: RunFacts['result'],
    verification: Verification | null,
  ) {
    return buildRunRecord({
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
    setTab('findings')
  }

  // A run that gave no answer is kept as a record too, never retried elsewhere.
  async function failed(c: ActiveCase, request: Request, from: Started, error: string) {
    setRun({ state: 'failed', error, record: await recordOf(c, request, from, { error }, null) })
  }

  // Never sends evidence off the device; at most it asks for consent, and
  // only when the cloud is allowed for this case.
  async function start(request: Request) {
    if (!active) return
    setResult(null)
    const c = active
    if (request === 'on_device') setRun({ state: 'working', where: 'device', since: Date.now() })
    const from = started()
    try {
      const out = await investigate(c.engine, request, c.prompt)
      if (out.kind === 'done') await finish(c, request, out, from)
      else if (cloudAllowed) setRun({ state: 'consent', request, ...out })
      else await failed(c, request, from, `Nothing was sent to the cloud. ${out.detail}`)
    } catch (e) {
      await failed(c, request, from, `Nothing was sent to the cloud. ${describe(e)}`)
    }
  }

  // The only path to the cloud: the analyst's click on "Send".
  async function consent(request: Request, reason: ConsentReason) {
    if (!active || !cloudAllowed) return
    const c = active
    setRun({ state: 'working', where: 'cloud', since: Date.now() })
    const from = started()
    try {
      await finish(c, request, await sendWithConsent(c.engine, reason, c.prompt), from)
    } catch (e) {
      await failed(c, request, from, `Cloud inference failed. ${describe(e)}`)
    }
  }

  const busy = run.state === 'working'
  const nano = nanoStatus(availability)
  const cloud = cloudStatus()

  const fileProblems = fileErrors.length > 0 && (
    <div className="notice fail" role="alert">
      <p>The file was not opened. Nothing in it was used.</p>
      <ul>
        {fileErrors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </div>
  )

  return (
    <>
      <header className="topbar">
        <a
          className="brand"
          href="#/"
          aria-label="Project Studio home"
          onClick={(e) => {
            e.preventDefault()
            goHome()
          }}
        >
          <span className="mark" aria-hidden="true" />
          <div>
            <strong>Project Studio</strong>
            <span>by PHANG Group</span>
          </div>
        </a>
        <div className="chips">
          <button
            className={`chip ${nano.tone}`}
            onClick={() => setShowSystem((open) => !open)}
            aria-expanded={showSystem}
          >
            <span className="dot" aria-hidden="true" />
            <span className="long">On-device AI: {nano.label}</span>
            <span className="short">Nano: {nano.short}</span>
          </button>
          <button
            className={`chip ${cloud.tone}`}
            onClick={() => setShowSystem((open) => !open)}
            aria-expanded={showSystem}
          >
            <span className="dot" aria-hidden="true" />
            <span className="long">Cloud AI: {cloud.label}</span>
            <span className="short">Cloud: {cloud.short}</span>
          </button>
        </div>
      </header>

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

      <main className="shell">
        {showSystem && (
          <section className="card system" aria-label="System details">
            <div className="card-head">
              <h2>System</h2>
              <button className="ghost" onClick={() => setShowSystem(false)}>
                Close
              </button>
            </div>
            <dl>
              <dt>On-device AI (Gemini Nano in Chrome)</dt>
              <dd className={nano.tone}>{availability}</dd>
              <dt>Cloud AI</dt>
              <dd>
                {CLOUD_MODEL} through Firebase AI Logic, only after your consent
              </dd>
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
          </section>
        )}

        {active === null || atHome ? (
          <>
            <Dashboard
              investigations={kept}
              busy={busy}
              nano={{ label: nano.label, tone: nano.tone }}
              cloud={{ label: cloud.label, tone: cloud.tone }}
              onOpen={openInvestigation}
              intro={
                <>
                  <div className="hero-copy">
                    <p className="eyebrow">AI proposes. Code verifies. The analyst decides.</p>
                    <h1>Investigate security events. Keep control of your evidence.</h1>
                    <p className="lede">
                      Project Studio uses AI to investigate security events, checks proposed
                      findings against original evidence, and keeps the analyst in control of every
                      decision.
                    </p>
                    {fileProblems}
                  </div>
                  <div className="dash-actions">
                    <button
                      className="primary"
                      onClick={() => fileInput.current?.click()}
                      disabled={busy}
                    >
                      Open a case file
                    </button>
                    <button className="secondary" onClick={openDemo} disabled={busy}>
                      Try the sample investigation
                    </button>
                    <p className="hint">
                      A case file is read and checked in this browser; opening one uploads
                      nothing. The sample uses simulated InfoPro authentication events.
                    </p>
                  </div>
                </>
              }
              current={
                active && (
                  <section className="card resume" aria-label="Open case">
                    <div>
                      <p className="eyebrow">Open case</p>
                      <strong>{caseTitle(active)}</strong>
                      <p className="meta">
                        {busy
                          ? 'Investigation running'
                          : result?.record
                            ? `Findings ready: ${result.report.counts.verified} of ${result.report.findings.length} verified · ${result.record.execution.model ?? 'no model'}`
                            : result
                              ? 'Worked example open'
                              : 'Not investigated yet'}
                      </p>
                    </div>
                    <div className="actions">
                      <button className="primary" onClick={() => setAtHome(false)}>
                        Resume
                      </button>
                      <button className="ghost" onClick={() => show(null)} disabled={busy}>
                        Close case
                      </button>
                    </div>
                  </section>
                )
              }
              preview={
                PREVIEW && <Preview report={PREVIEW} onOpen={openWorkedExample} busy={busy} />
              }
            />

            {kept.length === 0 && (
              <>
              <section className="steps" aria-label="How it works">
                <article>
                  <span className="step">1</span>
                  <h2>AI proposes</h2>
                  <p>
                    Gemini Nano investigates on this device. The cloud is used only if you allow it,
                    and you are asked every time before evidence is sent.
                  </p>
                </article>
                <article>
                  <span className="step">2</span>
                  <h2>Code verifies</h2>
                  <p>
                    Each finding is checked against the records it cites: the events exist, are what
                    the finding says they are, and match its times, accounts and computer names.
                  </p>
                </article>
                <article>
                  <span className="step">3</span>
                  <h2>The analyst decides</h2>
                  <p>
                    Verified, rejected and unchecked findings are shown apart from the AI's own
                    conclusion. Export a report you can keep.
                  </p>
                </article>
              </section>

              <p className="audience">
                Built for incident responders and security consultants who want AI help with
                authentication evidence without sending it to a cloud model by default.
              </p>
              </>
            )}
          </>
        ) : (
          <>
            <section className="casebar">
              <div>
                <p className="eyebrow">
                  {active.origin === 'demo' ? 'Sample investigation' : 'Case file'}
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

            <nav className="tabs" role="tablist" aria-label="Investigation">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  className={tab === t.id ? 'tab active' : 'tab'}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                  {t.id === 'run' && busy && (
                    <>
                      <span className="running" aria-hidden="true" />
                      <span className="visually-hidden"> (running)</span>
                    </>
                  )}
                  {t.id === 'findings' && result && (
                    <span className="count">{result.report.findings.length}</span>
                  )}
                </button>
              ))}
            </nav>

            {tab === 'evidence' && (
              <section className="card" role="tabpanel" aria-label="Evidence">
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
                  <button className="primary" onClick={() => setTab('run')}>
                    Next: run the investigation
                  </button>
                </div>
              </section>
            )}

            {tab === 'run' && (
              <section className="card" role="tabpanel" aria-label="Run">
                <h2>Where should the AI run?</h2>
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
                        // Turning the cloud off withdraws a question already on screen.
                        if (run.state === 'consent') setRun({ state: 'idle' })
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
                  <button
                    className="primary"
                    onClick={() => start(where)}
                    disabled={busy}
                  >
                    Run investigation
                  </button>
                </div>
                {run.state === 'working' && (
                  <Working where={run.where} since={run.since} events={active.events.length} />
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
                      <button className="secondary" onClick={() => setRun({ state: 'declined' })}>
                        Keep on this device
                      </button>
                    </div>
                    {!firebaseConfigured && (
                      <p className="hint">The cloud needs the Firebase web app config in .env.local.</p>
                    )}
                  </div>
                )}
                {run.state === 'declined' && (
                  <p className="notice">Nothing was sent. The investigation stays on this device.</p>
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
            )}

            {tab === 'findings' &&
              (result ? (
                <ReportView
                  report={result.report}
                  showActions={false}
                  onExport={() => exportReport(result.report)}
                  onRecord={result.record ? () => download(result.record!) : undefined}
                />
              ) : (
                <Empty onRun={() => setTab('run')} onExample={openWorkedExample} />
              ))}

            {tab === 'report' &&
              (result ? (
                <section className="card" role="tabpanel" aria-label="Report">
                  <h2>Keep a record of this investigation</h2>
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
                <Empty onRun={() => setTab('run')} onExample={openWorkedExample} />
              ))}
          </>
        )}
      </main>

      <footer className="footer">
        <p>Project Studio by PHANG Group.</p>
        <p>
          MITRE ATT&amp;CK® references: {ATTACK_NOTICE}{' '}
          <a href={ATTACK_TERMS_URL} target="_blank" rel="noreferrer">
            Terms of use
          </a>
          .
        </p>
      </footer>
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
function Working({ where, since, events }: { where: 'device' | 'cloud'; since: number; events: number }) {
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
          ? 'Nothing leaves this computer. On a laptop this often takes a minute or more; you can read the evidence meanwhile.'
          : `You consented to send these ${events} events; the answer comes back to this page.`}
        {device && seconds >= 120 &&
          ' Still working: Gemini Nano runs on this computer’s own hardware, and slower machines can take several minutes.'}
      </p>
    </div>
  )
}

// What a result looks like, before any case is open: the worked example's
// real verdicts, labelled as the example, never as a model's run.
function Preview({ report, onOpen, busy }: { report: Report; onOpen: () => void; busy: boolean }) {
  const total = report.findings.length
  return (
    <aside className="preview" aria-label="Worked example result">
      <p className="preview-label">
        Worked example · simulated data · written by the Project Studio team, no AI ran
      </p>
      <p className="preview-title">
        <strong>
          {report.counts.verified} of {total} findings verified
        </strong>{' '}
        against the evidence they cite
      </p>
      <div className="tiles compact" aria-label="Verdicts, decided by code">
        {VERDICTS.map((v) => (
          <div key={v} className={`tile ${v}`}>
            <span>{VERDICT_LABEL[v]}</span>
            <strong>{report.counts[v]}</strong>
          </div>
        ))}
      </div>
      <ul className="preview-findings">
        {report.findings.slice(0, 4).map((f) => (
          <li key={f.number}>
            <span className={`verdict ${f.verdict}`}>{VERDICT_LABEL[f.verdict]}</span>
            <span className="preview-claim">{f.claim}</span>
          </li>
        ))}
      </ul>
      <button className="secondary" onClick={onOpen} disabled={busy}>
        See how verification works
      </button>
    </aside>
  )
}

function Empty({ onRun, onExample }: { onRun: () => void; onExample: () => void }) {
  return (
    <section className="card empty" role="tabpanel">
      <h2>No findings yet</h2>
      <p className="hint">
        Run the investigation to get the AI&apos;s findings, each checked against the evidence.
        Or open the worked example to see every kind of verdict.
      </p>
      <div className="actions">
        <button className="primary" onClick={onRun}>
          Go to Run
        </button>
        <button className="secondary" onClick={onExample}>
          See how verification works
        </button>
      </div>
    </section>
  )
}

export default App
