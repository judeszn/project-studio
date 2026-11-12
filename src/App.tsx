import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { InferenceMode } from 'firebase/ai'
import { GS03_EVENTS } from './data/gs03'
import { ATTACK_NOTICE, ATTACK_REFERENCES, ATTACK_TERMS_URL, attackUrl } from './lib/attack'
import { MAX_CASE_BYTES, parseCaseFile } from './lib/casefile'
import type { CaseSource, LoadedCase, Provenance } from './lib/casefile'
import { ai, appCheckMode, firebaseConfigured } from './lib/firebase'
import {
  CLOUD_MODEL,
  LOCAL_MODE,
  NO_PROMPT_API,
  createEngine,
  investigate,
  sendWithConsent,
} from './lib/hybrid'
import type { ConsentReason, Done, Engine, Request, buildModels } from './lib/hybrid'
import { SYSTEM_PROMPT, authSystemPrompt, buildPrompt } from './lib/prompts'
import { buildRunRecord, locationOf, readOnDeviceParams, recordFileName, sha256Hex } from './lib/record'
import type { RunFacts, RunRecord } from './lib/record'
import { FINDING_TYPES, LANL_FINDING_TYPES, lanlProposalSchema } from './lib/schema'
import type { FindingType, LogEvent } from './lib/schema'
import { verifyProposal } from './lib/verify'
import type { FindingSupport, Problem, Support, Verification } from './lib/verify'
import './App.css'

// A case (the built-in synthetic one, or a case file the analyst opens from
// disk) -> Gemini Nano on this device, or, only with the analyst's consent,
// Gemini in the cloud (see lib/hybrid.ts) -> incident proposal -> the same
// deterministic checks -> a run record the analyst can keep.

// Everything a run needs for one case. The engine is built per case, because
// the instruction and the finding types belong to the evidence.
interface ActiveCase {
  id: string
  origin: 'built-in' | 'case file'
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

const BUILT_IN: ActiveCase = {
  id: 'GS-03',
  origin: 'built-in',
  fileName: null,
  sha256: null,
  source: null,
  modelNotes: [],
  events: GS03_EVENTS,
  provenance: null,
  findingTypes: FINDING_TYPES,
  systemPrompt: SYSTEM_PROMPT,
  prompt: buildPrompt(GS03_EVENTS),
  ...createEngine(ai, SYSTEM_PROMPT),
}

// A case file holds authentication events, so it gets their instruction,
// finding types and response schema.
function openCase(loaded: LoadedCase, fileName: string, sha256: string): ActiveCase {
  const systemPrompt = authSystemPrompt(loaded.modelNotes)
  return {
    id: loaded.id,
    origin: 'case file',
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
  | { state: 'working'; where: 'device' | 'cloud' }
  | { state: 'consent'; request: Request; reason: ConsentReason; detail: string }
  | { state: 'failed'; error: string; record?: RunRecord }

interface RunResult {
  request: Request
  done: Done
  findingTypes: readonly FindingType[]
  verification: Verification
  record: RunRecord
}

// When a run began, and whether the browser was online then.
interface Started {
  at: string
  online: boolean
}

const started = (): Started => ({ at: new Date().toISOString(), online: navigator.onLine })

// Saved by the browser to the analyst's disk. Nothing is uploaded.
function download(record: RunRecord) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = recordFileName(record)
  link.click()
  URL.revokeObjectURL(url)
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
  const [active, setActive] = useState(BUILT_IN)
  const [allowCloud, setAllowCloud] = useState(false)
  const [fileErrors, setFileErrors] = useState<string[]>([])
  const [availability, setAvailability] = useState('checking…')
  const [init, setInit] = useState<Step>({ state: 'idle' })
  const [progress, setProgress] = useState<number | null>(null)
  const [run, setRun] = useState<Run>({ state: 'idle' })
  const [result, setResult] = useState<RunResult | null>(null)

  const { engine, models } = active
  // The built-in case is synthetic. A case file is the analyst's evidence:
  // the cloud is off for it until they turn it on, and even then every send
  // waits for their consent.
  const cloudAllowed = active.origin === 'built-in' || allowCloud

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

  function show(next: ActiveCase) {
    setActive(next)
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
    setResult({ request, done, findingTypes: c.findingTypes, verification, record })
    setRun({ state: 'done' })
  }

  // A run that gave no answer is kept as a record too, never retried elsewhere.
  async function failed(c: ActiveCase, request: Request, from: Started, error: string) {
    setRun({ state: 'failed', error, record: await recordOf(c, request, from, { error }, null) })
  }

  // Never sends evidence off the device; at most it asks for consent, and
  // only when the cloud is allowed for this case.
  async function start(request: Request) {
    setResult(null)
    const c = active
    if (request === 'on_device') setRun({ state: 'working', where: 'device' })
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
    if (!cloudAllowed) return
    const c = active
    setRun({ state: 'working', where: 'cloud' })
    const from = started()
    try {
      await finish(c, request, await sendWithConsent(c.engine, reason, c.prompt), from)
    } catch (e) {
      await failed(c, request, from, `Cloud inference failed. ${describe(e)}`)
    }
  }

  const busy = run.state === 'working'
  const events = active.events.length

  return (
    <main>
      <h1>Project Studio</h1>
      <p className="lede">
        An incident proposal from Gemini Nano on this device. If Nano cannot run it, you are
        asked before any evidence is sent to Gemini in the cloud. The same code checks either
        answer.
      </p>

      <Panel
        title="Environment"
        status={`Nano: ${availability} · ${online ? 'online' : 'offline'}`}
      >
        <dl>
          <dt>Network (navigator.onLine)</dt>
          <dd className={online ? '' : 'warn'}>{online ? 'online' : 'offline'}</dd>
          <dt>Prompt API availability (text)</dt>
          <dd className={availability === 'available' ? 'ok' : 'warn'}>{availability}</dd>
          <dt>Inference modes (Firebase AI Logic)</dt>
          <dd>
            {LOCAL_MODE} until you consent; then {InferenceMode.PREFER_ON_DEVICE} (Nano
            unavailable) or {InferenceMode.PREFER_IN_CLOUD} (Nano failed, or cloud asked for)
          </dd>
          <dt>Cloud model</dt>
          <dd>{CLOUD_MODEL}</dd>
          <dt>Firebase project</dt>
          <dd className={firebaseConfigured ? 'ok' : 'warn'}>
            {firebaseConfigured
              ? import.meta.env.VITE_FIREBASE_PROJECT_ID
              : 'not configured (placeholder; cloud calls cannot succeed)'}
          </dd>
          <dt>App Check</dt>
          <dd className={appCheckMode === 'not initialised' ? 'warn' : 'ok'}>{appCheckMode}</dd>
        </dl>
      </Panel>

      <Panel
        title="1. On-device model"
        status={availability === 'available' ? 'ready' : availability}
        open={availability !== 'available' && availability !== 'checking…'}
      >
        <button onClick={initialise} disabled={init.state === 'working'}>
          Initialise on-device model
        </button>
        {init.state === 'working' && (
          <p>
            {progress === null
              ? 'Preparing model…'
              : `Downloading model: ${Math.round(progress * 100)}%`}
          </p>
        )}
        {init.state === 'done' && <p className="ok">Model ready on this device.</p>}
        {init.state === 'failed' && <p className="fail">Initialisation failed. {init.error}</p>}
      </Panel>

      <section>
        <h2>2. Investigate</h2>
        <div className="case">
          <label htmlFor="case-file">Open a case file (JSON)</label>
          <input
            id="case-file"
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              openFile(e.target.files?.[0])
              e.target.value = '' // so the same file can be opened again
            }}
          />
          <p className="hint">
            The file is read and checked in this browser. Opening it uploads nothing.
          </p>
          {fileErrors.length > 0 && (
            <>
              <p className="fail">The file was not opened. Nothing in it was used.</p>
              <ul className="fail">
                {fileErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </>
          )}
        </div>
        {active.origin === 'built-in' ? (
          <p className="hint">
            Built-in case: synthetic data. Scenario GS-03 at the fictional Goldshadow Finance. No
            real organisation, person or system.
          </p>
        ) : (
          <>
            <dl>
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
            <button className="secondary" onClick={() => show(BUILT_IN)} disabled={busy}>
              Close this case and use the built-in one
            </button>
          </>
        )}
        <details className="sub">
          <summary>
            <h3>Evidence</h3>
            <span className="status">{events} events</span>
          </summary>
          <EventList events={active.events} provenance={active.provenance} />
        </details>
        <div className="actions">
          <button onClick={() => start('on_device')} disabled={busy}>
            Investigate on this device
          </button>
          {cloudAllowed && (
            <button className="secondary" onClick={() => start('in_cloud')} disabled={busy}>
              Compare: investigate in the cloud
            </button>
          )}
        </div>
        {active.origin === 'case file' && (
          <label className="check">
            <input
              type="checkbox"
              checked={allowCloud}
              disabled={busy}
              onChange={(e) => {
                setAllowCloud(e.target.checked)
                // Turning the cloud off withdraws a question already on screen.
                if (run.state === 'consent') setRun({ state: 'idle' })
              }}
            />
            Allow the cloud for this case. You are still asked before anything is sent.
          </label>
        )}
        <p className="hint">
          {cloudAllowed
            ? 'Evidence leaves this device only if you press Send below. Nothing is sent automatically.'
            : 'The cloud is off for this case: it runs on this device or not at all. If Gemini Nano fails, the failure is recorded and nothing is sent.'}
        </p>
        {run.state === 'working' && (
          <p>{run.where === 'cloud' ? 'Waiting for the cloud model…' : 'Running on-device inference…'}</p>
        )}
        {run.state === 'consent' && (
          <div className="consent">
            <p className="warn">{run.detail}</p>
            <p>
              Send these {events} events to {CLOUD_MODEL} through Firebase AI Logic? Nothing has
              been sent yet.
            </p>
            <div className="actions">
              <button
                onClick={() => consent(run.request, run.reason)}
                disabled={!firebaseConfigured}
              >
                Send {events} events to the cloud
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
          <p>Nothing was sent. The investigation stays on this device.</p>
        )}
        {run.state === 'failed' && (
          <>
            <p className="fail">{run.error}</p>
            {run.record && (
              <button className="secondary" onClick={() => download(run.record!)}>
                Download the record of this failed run
              </button>
            )}
          </>
        )}
      </section>

      {result && <Result result={result} />}

      <footer className="hint">
        MITRE ATT&amp;CK® references: {ATTACK_NOTICE}{' '}
        <a href={ATTACK_TERMS_URL} target="_blank" rel="noreferrer">
          Terms of use
        </a>
        .
      </footer>
    </main>
  )
}

function EventList({
  events,
  provenance,
}: {
  events: LogEvent[]
  provenance: Record<string, Provenance> | null
}) {
  return (
    <ol className="events">
      {events.map((e) => (
        <li key={e.id}>
          <div>
            <strong>{e.id}</strong>{' '}
            <span className="hint">
              {e.date} {e.time} · {e.source}
            </span>
          </div>
          <div>
            {e.actor} · {e.action}: {e.target} · {e.outcome}
          </div>
          <div className="hint">{e.detail}</div>
          {provenance?.[e.id] && (
            <div className="hint">
              Original record, {provenance[e.id].file} line {provenance[e.id].line}:{' '}
              <code>{provenance[e.id].raw}</code>
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

// A section that folds away, so a long result reads on a phone. The summary
// line keeps the essentials visible while it is closed.
function Panel({
  title,
  status,
  open = false,
  children,
}: {
  title: string
  status?: string
  open?: boolean
  children: ReactNode
}) {
  return (
    <details className="panel" open={open}>
      <summary>
        <h2>{title}</h2>
        {status && <span className="status">{status}</span>}
      </summary>
      <div className="panel-body">{children}</div>
    </details>
  )
}

function Sub({
  title,
  status,
  open = false,
  children,
}: {
  title: string
  status?: string
  open?: boolean
  children: ReactNode
}) {
  return (
    <details className="sub" open={open}>
      <summary>
        <h3>{title}</h3>
        {status && <span className="status">{status}</span>}
      </summary>
      {children}
    </details>
  )
}

function Result({ result }: { result: RunResult }) {
  const { verification, done, record } = result
  const location = locationOf(done.inferenceSource)
  const passing = verification.passes.filter(Boolean).length
  // On a phone the result lands below the buttons, out of sight.
  const top = useRef<HTMLElement>(null)
  useEffect(() => {
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])
  return (
    <section ref={top}>
      <h2>3. Proposal</h2>
      <p className={`where ${location === 'cloud' ? 'cloud' : 'device'}`}>
        {location === 'on-device'
          ? done.consented
            ? 'Ran on this device: Gemini Nano, after you agreed to the cloud.'
            : 'Ran on this device: Gemini Nano. Nothing was sent to the cloud.'
          : location === 'cloud'
            ? `Ran in the cloud: ${CLOUD_MODEL}. The evidence was sent after your consent.`
            : 'The SDK did not report where this ran.'}
      </p>
      <div className="actions">
        <button className="secondary" onClick={() => download(record)}>
          Download run record
        </button>
      </div>
      <p className="hint">
        The record holds the case's hash, the prompts and their hashes, the raw output, where
        it ran, the latency and every check result. It is saved to your disk and contains the
        evidence.
      </p>
      <dl>
        <dt>Inference source (reported by SDK)</dt>
        <dd className={sourceClass(done)}>
          {done.inferenceSource}
          {sourceNote(done)}
        </dd>
        <dt>Schema validation (by code)</dt>
        <dd className={verification.parse.ok ? 'ok' : 'fail'}>
          {verification.parse.ok ? 'valid' : 'invalid'}
        </dd>
        {verification.parse.ok && (
          <>
            <dt>Classification (proposed by the model, not verified)</dt>
            <dd>{verification.parse.proposal.classification}</dd>
            <dt>Confidence (the model's own, not verified)</dt>
            <dd>{verification.parse.proposal.confidence}</dd>
            <dt>Findings that pass every check (by code)</dt>
            <dd className={passClass(verification.passes)}>
              {passing} of {verification.passes.length},
              covering {verification.covered.length} distinct event
              {verification.covered.length === 1 ? '' : 's'}
            </dd>
            <dt>Citation, time, account and repeat checks (by code)</dt>
            <dd className={verification.problems.length === 0 ? 'ok' : 'fail'}>
              {verification.problems.length === 0
                ? 'no problem found'
                : `${verification.problems.length} problem(s)`}
            </dd>
            <dt>Evidence support checks (by code)</dt>
            <dd className={supportClass(verification.support)}>
              {verification.support.filter((s) => s.status === 'supported').length} of{' '}
              {verification.support.length} findings supported
            </dd>
          </>
        )}
      </dl>
      {!verification.parse.ok && (
        <ul className="fail">
          {verification.parse.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <Sub
        title="How it ran"
        status={`${done.mode} · ${(done.latencyMs / 1000).toFixed(1)} s · consent ${done.consented ? 'given' : 'not needed'}`}
      >
        <dl>
          <dt>Inference requested</dt>
          <dd>{result.request === 'on_device' ? 'on this device' : 'in the cloud'}</dd>
          <dt>Consent to send evidence to the cloud</dt>
          <dd>{done.consented ? 'given' : 'not asked; nothing was sent'}</dd>
          <dt>Inference preference (SDK mode)</dt>
          <dd>{done.mode}</dd>
          <dt>Latency</dt>
          <dd>{done.latencyMs} ms</dd>
          <dt>Network during run</dt>
          <dd>
            {record.execution.onlineAtStart ? 'online' : 'offline'} at start,{' '}
            {record.execution.onlineAtEnd ? 'online' : 'offline'} at end
          </dd>
        </dl>
      </Sub>
      {verification.parse.ok && (
        <>
          <Sub title="Explanation" open>
            <p>{verification.parse.proposal.explanation}</p>
            <p className="hint">
              Prose by the model. Code checks only the events, times and accounts it names.
            </p>
            <ProblemList problems={problemsAt(verification.problems, 'explanation')} />
          </Sub>

          <Sub
            title="Findings"
            status={`${passing} of ${verification.passes.length} pass`}
            open
          >
            <p className="hint">
              Three code checks per finding. Citations: the cited events exist, and quoted times
              and accounts belong to them. Support: the cited events are of the kind, and have
              the outcome, that the finding's type states. Repeats: the finding does not repeat
              another. A finding passes only if it clears all three. None reads the wording of a
              claim.
            </p>
            <ProblemList problems={problemsAt(verification.problems, 'findings')} />
            <ol>
              {verification.parse.proposal.findings.map((finding, i) => {
                const problems = problemsAt(verification.problems, `findings[${i}]`)
                const support = verification.support[i]
                const passes = verification.passes[i]
                const reference = ATTACK_REFERENCES[finding.type]
                return (
                  <li key={i} className="finding">
                    <div>
                      {passes ? (
                        <span className="ok">Passes every check</span>
                      ) : (
                        <>
                          <span className="fail">Does not pass:</span>{' '}
                          <span className={SUPPORT_CLASS[support.status]}>
                            {SUPPORT_LABEL[support.status]}
                          </span>
                        </>
                      )}
                    </div>
                    <div>{finding.claim}</div>
                    <div className="hint">
                      {finding.type} · cites {finding.event_ids.join(', ') || 'no event'}
                    </div>
                    {TYPE_NOTE[finding.type] && <p className="hint">{TYPE_NOTE[finding.type]}</p>}
                    {passes && reference && (
                      <p className="hint">
                        ATT&amp;CK reference, if this was adversary activity:{' '}
                        <a href={attackUrl(reference.id)} target="_blank" rel="noreferrer">
                          {reference.id} {reference.name}
                        </a>
                        . A reference, not a conclusion.
                      </p>
                    )}
                    <ProblemList problems={problems} />
                    {support.notes.length > 0 && (
                      <ul className="fail">
                        {support.notes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ol>
            <p className="hint">
              Events no finding cites:{' '}
              {verification.uncited.length > 0 ? verification.uncited.join(', ') : 'none'}. Code
              does not judge whether they matter.
            </p>
          </Sub>

          <Sub
            title="Recommended actions"
            status={`${verification.parse.proposal.recommended_actions.length}, proposed, not taken`}
          >
            <ol>
              {verification.parse.proposal.recommended_actions.map((action, i) => (
                <li key={i}>
                  {action}
                  <ProblemList
                    problems={problemsAt(verification.problems, `recommended_actions[${i}]`)}
                  />
                </li>
              ))}
            </ol>
          </Sub>
        </>
      )}
      <Sub title="Raw model output">
        <pre>{done.text}</pre>
      </Sub>
    </section>
  )
}

// Without consent the only mode is LOCAL_MODE, so anything but on_device there
// is a fault. After consent either source is legitimate; the note says why.
function sourceClass(done: Done): string {
  if (done.mode === LOCAL_MODE) return done.inferenceSource === 'on_device' ? 'ok' : 'fail'
  return 'ok'
}

function sourceNote(done: Done): string {
  if (done.mode === LOCAL_MODE) return done.inferenceSource === 'on_device' ? '' : ' (unexpected)'
  if (done.inferenceSource !== 'on_device') return ''
  return done.mode === InferenceMode.PREFER_IN_CLOUD
    ? ' (the cloud call failed, so the SDK used Gemini Nano)'
    : ' (Gemini Nano had become available, so nothing was sent)'
}

// What a type does and does not say, shown beside every finding of it: code
// checks the cited events, not the wording of the claim.
const TYPE_NOTE: Partial<Record<FindingType, string>> = {
  logon: 'A logon is an account authenticating to a computer. It is not by itself an attack.',
  denied_logon:
    'A denied logon is an attempt the evidence records as refused. It does not show that access was obtained, that an account is compromised, or an attack.',
}

const problemsAt = (problems: Problem[], path: string) => problems.filter((p) => p.path === path)

const SUPPORT_LABEL: Record<Support, string> = {
  supported: 'supported by the cited events',
  unsupported: 'not supported by the cited events',
  contradicted: 'contradicted by the cited events',
  unchecked: 'not checked by code (type "other")',
}

const SUPPORT_CLASS: Record<Support, string> = {
  supported: 'ok',
  unsupported: 'fail',
  contradicted: 'fail',
  unchecked: 'warn',
}

// Green only when there is at least one finding and every one passes.
function passClass(passes: boolean[]): string {
  return passes.length > 0 && passes.every(Boolean) ? 'ok' : 'fail'
}

// Green only when every finding is supported; amber when the rest are unchecked.
function supportClass(support: FindingSupport[]): string {
  if (support.some((s) => s.status === 'unsupported' || s.status === 'contradicted')) return 'fail'
  return support.length > 0 && support.every((s) => s.status === 'supported') ? 'ok' : 'warn'
}

function ProblemList({ problems }: { problems: Problem[] }) {
  if (problems.length === 0) return null
  return (
    <ul className="fail">
      {problems.map((p, i) => (
        <li key={i}>{p.problem}</li>
      ))}
    </ul>
  )
}

export default App
