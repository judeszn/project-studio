import { useEffect, useState } from 'react'
import { InferenceMode, getGenerativeModel } from 'firebase/ai'
import type { LanguageModelCreateOptions } from 'firebase/ai'
import { GS03_EVENTS } from './data/gs03'
import { ai, appCheckConfigured, firebaseConfigured } from './lib/firebase'
import { incidentProposalSchema } from './lib/schema'
import type { LogEvent } from './lib/schema'
import { verifyProposal } from './lib/verify'
import type { Problem, Verification } from './lib/verify'
import './App.css'

// Milestone 1 proof of concept: a fixed set of synthetic log events -> Gemini
// Nano, on this device only -> incident proposal -> deterministic checks.
// Nothing else.

const SYSTEM_PROMPT =
  'You assist a security analyst. You are given a list of log events from one ' +
  'organisation, each with an ID. Propose what kind of incident, if any, the events ' +
  'show. Use only the events given. Every finding must cite the IDs of the events ' +
  'that support it, and must quote times exactly as the events give them. Do not ' +
  'say that data was accessed or taken, or that a person is at fault, unless an ' +
  'event says so. If the events are not enough to decide, choose Undetermined. ' +
  'You make a proposal. The analyst decides.'

const createOptions: LanguageModelCreateOptions = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
  initialPrompts: [{ role: 'system', content: [{ type: 'text', value: SYSTEM_PROMPT }] }],
}

// ONLY_ON_DEVICE: the SDK never falls back to the cloud in this mode.
const model = getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: {
    createOptions,
    promptOptions: { responseConstraint: incidentProposalSchema },
  },
})

// Chrome's Prompt API, read directly so the page can show what the browser
// itself reports, independently of the Firebase SDK.
const promptApi = (
  globalThis as { LanguageModel?: { availability(options?: object): Promise<string> } }
).LanguageModel

const NO_PROMPT_API =
  'This browser does not expose the Prompt API (LanguageModel). On-device inference cannot run here.'

async function readAvailability(): Promise<string> {
  if (!promptApi) return 'no Prompt API'
  try {
    return await promptApi.availability(createOptions)
  } catch (e) {
    return `error: ${describe(e)}`
  }
}

function describe(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e)
}

const eventLine = (e: LogEvent) =>
  [e.id, `${e.date} ${e.time}`, e.source, e.actor, e.action, e.target, e.outcome, e.detail].join(' | ')

function buildPrompt(events: LogEvent[]): string {
  return (
    'Events (ID | date time | source | actor | action | target | outcome | detail):\n' +
    events.map(eventLine).join('\n') +
    '\n\nPropose a classification for these events, with findings that cite event IDs.'
  )
}

type Step =
  | { state: 'idle' }
  | { state: 'working' }
  | { state: 'done' }
  | { state: 'failed'; error: string }

interface RunResult {
  raw: string
  inferenceSource: string
  latencyMs: number
  onlineAtStart: boolean
  onlineAtEnd: boolean
  verification: Verification
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
  const [availability, setAvailability] = useState('checking…')
  const [init, setInit] = useState<Step>({ state: 'idle' })
  const [progress, setProgress] = useState<number | null>(null)
  const [run, setRun] = useState<Step>({ state: 'idle' })
  const [result, setResult] = useState<RunResult | null>(null)

  useEffect(() => {
    readAvailability().then(setAvailability)
  }, [])

  async function initialise() {
    if (!promptApi) {
      setInit({ state: 'failed', error: NO_PROMPT_API })
      return
    }
    setInit({ state: 'working' })
    setProgress(null)
    try {
      await model.initializeDeviceModel(setProgress)
      const now = await readAvailability()
      setAvailability(now)
      if (now !== 'available') throw new Error(`model is not ready: availability is "${now}"`)
      setInit({ state: 'done' })
    } catch (e) {
      setInit({ state: 'failed', error: describe(e) })
    }
  }

  async function propose() {
    setResult(null)
    if (!promptApi) {
      setRun({ state: 'failed', error: NO_PROMPT_API })
      return
    }
    setRun({ state: 'working' })
    const onlineAtStart = navigator.onLine
    try {
      const started = performance.now()
      const { response } = await model.generateContent(buildPrompt(GS03_EVENTS))
      const latencyMs = Math.round(performance.now() - started)
      const raw = response.text()
      setResult({
        raw,
        inferenceSource: response.inferenceSource ?? 'not reported',
        latencyMs,
        onlineAtStart,
        onlineAtEnd: navigator.onLine,
        verification: verifyProposal(raw, GS03_EVENTS),
      })
      setRun({ state: 'done' })
    } catch (e) {
      setRun({ state: 'failed', error: describe(e) })
    }
  }

  const ready = init.state === 'done'

  return (
    <main>
      <h1>Project Studio</h1>
      <p className="lede">
        Milestone 1 proof of concept: an on-device incident proposal with Gemini Nano, checked
        by code.
      </p>

      <section>
        <h2>Environment</h2>
        <dl>
          <dt>Network (navigator.onLine)</dt>
          <dd className={online ? '' : 'warn'}>{online ? 'online' : 'offline'}</dd>
          <dt>Prompt API availability (text)</dt>
          <dd className={availability === 'available' ? 'ok' : 'warn'}>{availability}</dd>
          <dt>Inference mode</dt>
          <dd>{InferenceMode.ONLY_ON_DEVICE} (no cloud fallback)</dd>
          <dt>Firebase project</dt>
          <dd className={firebaseConfigured ? 'ok' : 'warn'}>
            {firebaseConfigured ? 'configured' : 'not configured (placeholder; cloud calls cannot succeed)'}
          </dd>
          <dt>App Check</dt>
          <dd className={appCheckConfigured ? 'ok' : 'warn'}>
            {appCheckConfigured ? 'initialised' : 'not initialised'}
          </dd>
        </dl>
      </section>

      <section>
        <h2>1. On-device model</h2>
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
      </section>

      <section>
        <h2>2. Evidence</h2>
        <p className="hint">
          Synthetic data. Scenario GS-03 at the fictional Goldshadow Finance. No real
          organisation, person or system.
        </p>
        <EventTable events={GS03_EVENTS} />
        <button onClick={propose} disabled={!ready || run.state === 'working'}>
          Propose on this device
        </button>
        {!ready && <p className="hint">Initialise the on-device model first.</p>}
        {run.state === 'working' && <p>Running on-device inference…</p>}
        {run.state === 'failed' && (
          <p className="fail">
            On-device inference failed; no cloud request was attempted. {run.error}
          </p>
        )}
      </section>

      {result && <Result result={result} />}
    </main>
  )
}

function EventTable({ events }: { events: LogEvent[] }) {
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Time</th>
            <th>Source</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Outcome</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{e.id}</td>
              <td>
                {e.date} {e.time}
              </td>
              <td>{e.source}</td>
              <td>{e.actor}</td>
              <td>
                {e.action}: {e.target}
              </td>
              <td>{e.outcome}</td>
              <td>{e.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Result({ result }: { result: RunResult }) {
  const { verification } = result
  const onDevice = result.inferenceSource === 'on_device'
  return (
    <section>
      <h2>3. Proposal</h2>
      <dl>
        <dt>Inference source (reported by SDK)</dt>
        <dd className={onDevice ? 'ok' : 'fail'}>{result.inferenceSource}</dd>
        <dt>Latency</dt>
        <dd>{result.latencyMs} ms</dd>
        <dt>Network during run</dt>
        <dd>
          {result.onlineAtStart ? 'online' : 'offline'} at start,{' '}
          {result.onlineAtEnd ? 'online' : 'offline'} at end
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
            <dt>Citation and time checks (by code)</dt>
            <dd className={verification.problems.length === 0 ? 'ok' : 'fail'}>
              {verification.problems.length === 0
                ? 'no problem found'
                : `${verification.problems.length} problem(s)`}
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
      {verification.parse.ok && (
        <>
          <h3>Explanation</h3>
          <p>{verification.parse.proposal.explanation}</p>
          <ProblemList problems={problemsAt(verification.problems, 'explanation')} />

          <h3>Findings</h3>
          <p className="hint">
            The code check confirms that the cited events exist and that quoted times belong
            to them. It does not confirm that a finding reads those events correctly.
          </p>
          <ProblemList problems={problemsAt(verification.problems, 'findings')} />
          <ol>
            {verification.parse.proposal.findings.map((finding, i) => {
              const problems = problemsAt(verification.problems, `findings[${i}]`)
              return (
                <li key={i}>
                  {finding.claim}{' '}
                  <span className="hint">[{finding.event_ids.join(', ') || 'no event cited'}]</span>{' '}
                  {problems.length === 0 && <span className="ok">citations exist</span>}
                  <ProblemList problems={problems} />
                </li>
              )
            })}
          </ol>

          <h3>Recommended actions (proposed, not taken)</h3>
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
        </>
      )}
      <h3>Raw model output</h3>
      <pre>{result.raw}</pre>
    </section>
  )
}

const problemsAt = (problems: Problem[], path: string) => problems.filter((p) => p.path === path)

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
