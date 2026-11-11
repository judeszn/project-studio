import { useEffect, useState } from 'react'
import { InferenceMode, getGenerativeModel } from 'firebase/ai'
import type { InlineDataPart, LanguageModelCreateOptions } from 'firebase/ai'
import { ai, appCheckConfigured, firebaseConfigured } from './lib/firebase'
import { experimentRecordSchema } from './lib/schema'
import { verifyRecord } from './lib/verify'
import type { Verification } from './lib/verify'
import './App.css'

// Milestone 1 proof of concept: one photo + one note -> Gemini Nano, on this
// device only -> structured record -> deterministic checks. Nothing else.

const SYSTEM_PROMPT =
  'You turn a student\'s photo and written note about a science experiment into a ' +
  'structured experiment record. Use only what the note says and what is clearly ' +
  'visible in the photo. Copy numbers exactly as the note gives them and never ' +
  'estimate, convert or invent a number. If something is not stated, leave that ' +
  'field empty and name it in missing_information.'

const createOptions: LanguageModelCreateOptions = {
  expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
  initialPrompts: [{ role: 'system', content: [{ type: 'text', value: SYSTEM_PROMPT }] }],
}

// ONLY_ON_DEVICE: the SDK never falls back to the cloud in this mode.
const model = getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: {
    createOptions,
    promptOptions: { responseConstraint: experimentRecordSchema },
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

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error ?? new Error('could not read the image'))
    reader.readAsDataURL(file)
  })
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
  const [photo, setPhoto] = useState<File | null>(null)
  const [note, setNote] = useState('')
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

  async function generate() {
    if (!photo) return
    setResult(null)
    if (!promptApi) {
      setRun({ state: 'failed', error: NO_PROMPT_API })
      return
    }
    setRun({ state: 'working' })
    const onlineAtStart = navigator.onLine
    try {
      const imagePart: InlineDataPart = {
        type: 'inlineData',
        inlineData: { data: await toBase64(photo), mimeType: photo.type },
      }
      const prompt = `Student note:\n"""\n${note.trim()}\n"""\n\nFill in the experiment record from the photo and this note.`
      const started = performance.now()
      const { response } = await model.generateContent([prompt, imagePart])
      const latencyMs = Math.round(performance.now() - started)
      const raw = response.text()
      setResult({
        raw,
        inferenceSource: response.inferenceSource ?? 'not reported',
        latencyMs,
        onlineAtStart,
        onlineAtEnd: navigator.onLine,
        verification: verifyRecord(raw, note),
      })
      setRun({ state: 'done' })
    } catch (e) {
      setRun({ state: 'failed', error: describe(e) })
    }
  }

  const ready = init.state === 'done'
  const canGenerate = ready && photo !== null && note.trim() !== '' && run.state !== 'working'

  return (
    <main>
      <h1>Project Studio</h1>
      <p className="lede">
        Milestone 1 proof of concept: on-device experiment record with Gemini Nano.
      </p>

      <section>
        <h2>Environment</h2>
        <dl>
          <dt>Network (navigator.onLine)</dt>
          <dd className={online ? '' : 'warn'}>{online ? 'online' : 'offline'}</dd>
          <dt>Prompt API availability (text + image)</dt>
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
        <h2>2. Experiment evidence</h2>
        <label>
          Photo (JPEG or PNG)
          <input
            type="file"
            accept="image/jpeg,image/png"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Observation note
          <textarea
            rows={5}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What you did, what you measured, what you saw."
          />
        </label>
        <button onClick={generate} disabled={!canGenerate}>
          Generate record on this device
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

function Result({ result }: { result: RunResult }) {
  const { verification } = result
  const onDevice = result.inferenceSource === 'on_device'
  return (
    <section>
      <h2>3. Result</h2>
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
        <dt>Schema validation</dt>
        <dd className={verification.parse.ok ? 'ok' : 'fail'}>
          {verification.parse.ok ? 'valid' : 'invalid'}
        </dd>
        {verification.parse.ok && (
          <>
            <dt>Missing fields (checked by code)</dt>
            <dd className={verification.missingFields.length === 0 ? 'ok' : 'warn'}>
              {verification.missingFields.join(', ') || 'none'}
            </dd>
            <dt>Numbers not found in the note</dt>
            <dd className={verification.ungrounded.length === 0 ? 'ok' : 'fail'}>
              {verification.ungrounded.map((u) => `${u.value} (${u.path})`).join(', ') || 'none'}
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
      <h3>Model output</h3>
      <pre>{verification.parse.ok ? JSON.stringify(verification.parse.record, null, 2) : result.raw}</pre>
    </section>
  )
}

export default App
