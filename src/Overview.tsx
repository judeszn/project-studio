import type { ReactNode } from 'react'
import { FULL_NAME } from './site'

// The home page: the problem, what AEMAS does about it, and its limits, in
// that order. It describes only what works today; how the AI runs and what it
// is built with are shown where an analyst runs an investigation, not here.

export const DESCRIPTOR = 'Security event investigation and evidence verification'

export const HEADLINE = 'Security investigations should be driven by evidence, not assumptions.'

const WORKFLOW: { title: string; text: string }[] = [
  {
    title: 'Supply the evidence',
    text: 'Open a case file of authentication events. It is read and checked in your browser; opening it uploads nothing.',
  },
  {
    title: 'AI proposes findings',
    text: 'Each finding must cite the event records behind it. The AI runs on your device by default; the cloud is used only if you allow it, and you are asked before anything is sent.',
  },
  {
    title: 'Code checks every finding',
    text: 'Deterministic checks compare each finding with the records it cites and give it a verdict: Verified, Rejected, Contradicted or Unchecked, with the reasons.',
  },
  {
    title: 'The analyst reviews',
    text: 'Findings are shown with their verdicts and the original records. The AI’s overall conclusion is shown as its proposal, never as verified.',
  },
  {
    title: 'Report',
    text: 'Export a self-contained investigation report, and a run record that lets the analysis be checked again later.',
  },
]

export function Overview({
  notice,
  caseStudy,
  onStart,
  onCaseStudy,
  onHowVerdicts,
  busy,
}: {
  notice: ReactNode // a file that could not be opened, if any
  caseStudy: ReactNode
  onStart: () => void
  onCaseStudy: () => void
  onHowVerdicts: () => void
  busy: boolean
}) {
  return (
    <div className="overview">
      <section className="hero" aria-labelledby="headline">
        <p className="eyebrow">{DESCRIPTOR}</p>
        <h1 id="headline">{HEADLINE}</h1>
        <p className="lede">
          AEMAS ({FULL_NAME}) uses AI to investigate security events and checks proposed findings against the
          original records, helping security analysts establish what the evidence supports before
          they make decisions.
        </p>
        {notice}
        <div className="hero-actions">
          <button className="primary" onClick={onStart}>
            Start an Investigation
          </button>
          <button className="secondary" onClick={onCaseStudy}>
            Explore the Case Study
          </button>
        </div>
      </section>

      <section className="band" aria-labelledby="problem">
        <div className="band-text">
          <p className="eyebrow">The problem</p>
          <h2 id="problem">AI can read security events quickly. It can also be wrong.</h2>
          <p>
            Language models can summarise large volumes of log records in seconds. They can also
            cite records that do not exist, misread what a record shows, or draw conclusions the
            evidence does not support. In an investigation, an unsupported finding can send
            responders in the wrong direction.
          </p>
          <p>
            In our own testing, a model cited event IDs that were not in the evidence and described
            a successful logon as a denied one. AEMAS is built so that errors like these are caught
            before an analyst relies on them.
          </p>
        </div>
      </section>

      <section className="band" aria-labelledby="workflow">
        <p className="eyebrow">How an investigation works</p>
        <h2 id="workflow">AI proposes. Code verifies. The analyst decides.</h2>
        <ol className="workflow">
          {WORKFLOW.map((step) => (
            <li key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
        <p className="scope">
          <strong>Current scope:</strong> authentication events (logons and denied logons)
          supplied as a case file. AEMAS analyses the records you supply. It does not monitor
          systems, raise alerts or take action, and a verified finding does not by itself prove
          that an attack happened.
        </p>
        <div className="actions">
          <button className="primary" onClick={onStart}>
            Start an Investigation
          </button>
          <button className="ghost" onClick={onHowVerdicts} disabled={busy}>
            How verdicts work
          </button>
        </div>
      </section>

      {caseStudy}
    </div>
  )
}
