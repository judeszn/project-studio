import type { ReactNode } from 'react'
import { WORKED_EXAMPLE } from './data/worked-example'
import {
  CHECKS,
  DESCRIPTION,
  DOES_NOT,
  EVALUATION,
  HEADLINE,
  MOTTO,
  NIST_DE_AE_02,
  NIST_RS_AN_03,
  NOT_COMPLIANCE,
  QUALIFIER,
  QUESTIONS,
  REPRODUCIBLE,
  SOURCES,
  STEPS,
  VERDICT_EXAMPLES,
} from './home'
import { VERDICT_LABEL } from './lib/report'
import { FULL_NAME } from './site'

// The home page, in five blocks (owner's decision, 2026-11-24): what AEMAS is,
// how an investigation works, real verdicts, the method and the standards it
// maps to, and the case study. Only what works today; no story.

const external = { target: '_blank', rel: 'noreferrer' } as const

export function Overview({
  notice,
  onStart,
  onCaseStudy,
  onHowVerdicts,
  busy,
}: {
  notice: ReactNode // a file that could not be opened, if any
  onStart: () => void
  onCaseStudy: () => void
  onHowVerdicts: () => void
  busy: boolean
}) {
  return (
    <div className="overview">
      <section className="hero" aria-labelledby="headline">
        <p className="eyebrow">AEMAS ({FULL_NAME})</p>
        <h1 id="headline">{HEADLINE}</h1>
        <p className="lede">{DESCRIPTION}</p>
        <p className="motto">
          {MOTTO.map((part, i) => (
            <span key={part}>
              {part}
              {i < MOTTO.length - 1 ? ' ' : ''}
            </span>
          ))}
        </p>
        <p className="qualifier">{QUALIFIER}</p>
        {notice}
        <div className="hero-actions">
          <button className="primary" onClick={onStart}>
            Start an Investigation
          </button>
          <button className="secondary" onClick={onCaseStudy}>
            Explore Case Study
          </button>
        </div>
      </section>

      <section className="band" aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <ol className="workflow">
          {STEPS.map((step) => (
            <li key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="band" aria-labelledby="verification">
        <h2 id="verification">Verification</h2>
        <ol className="questions">
          {QUESTIONS.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
        <div className="vtable-wrap">
          <table className="vtable">
            <thead>
              <tr>
                <th>Verdict</th>
                <th>Finding</th>
                <th>Cites</th>
                <th>What the engine found</th>
              </tr>
            </thead>
            <tbody>
              {VERDICT_EXAMPLES.map(({ finding, verdict, found }) => {
                const f = WORKED_EXAMPLE.findings[finding - 1]
                return (
                  <tr key={finding}>
                    <td data-label="Verdict">
                      <span className={`verdict ${verdict}`}>{VERDICT_LABEL[verdict]}</span>
                    </td>
                    <td data-label="Finding">
                      <span className="vnum">#{finding}</span> “{f.claim}”
                    </td>
                    <td data-label="Cites" className="vcites">
                      {f.event_ids.join(', ')}
                    </td>
                    <td data-label="What the engine found">{found}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="hint">
          From the worked example on the simulated sample: findings written by the AEMAS team and
          checked by the same engine as a model’s.{' '}
          <button className="link" onClick={onHowVerdicts} disabled={busy}>
            How verdicts work
          </button>{' '}
          shows all seven.
        </p>
        <p className="hint">{REPRODUCIBLE}</p>
      </section>

      <section className="band" aria-labelledby="method">
        <h2 id="method">Method and standards</h2>
        <div className="method">
          <div className="checks-card">
            <h3>The checks</h3>
            <ul className="checks">
              {CHECKS.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="hint">{EVALUATION}</p>
          </div>
          <div className="standards-col">
            <h3>Where AEMAS fits</h3>
            <dl className="standards">
              <dt>
                <a href={SOURCES.sp80061r3} {...external}>
                  NIST SP 800-61 Rev. 3
                </a>{' '}
                (
                <a href={SOURCES.csf2} {...external}>
                  CSF 2.0
                </a>
                )
              </dt>
              <dd>
                <p>
                  Maps to <strong>DE.AE-02</strong>: “{NIST_DE_AE_02}”.
                </p>
                <p>
                  Supports <strong>RS.AN-03</strong> in part: “{NIST_RS_AN_03}”. AEMAS helps
                  establish what took place, not the root cause.
                </p>
              </dd>
              <dt>
                <a href={SOURCES.sans} {...external}>
                  SANS PICERL
                </a>
              </dt>
              <dd>The Identification phase.</dd>
              <dt>
                <a href={SOURCES.attack} {...external}>
                  MITRE ATT&amp;CK
                </a>
              </dt>
              <dd>Shown on verified findings as context, never as evidence.</dd>
            </dl>
            <p className="hint">{NOT_COMPLIANCE}</p>
          </div>
        </div>
        <p className="scope">{DOES_NOT}</p>
      </section>

      <section className="band teaser" aria-labelledby="case-teaser">
        <p className="eyebrow">Case study</p>
        <h2 id="case-teaser">Change Healthcare, 2024</h2>
        <p>
          Compromised credentials on a remote-access portal without multi-factor authentication.
          What the records could establish, and what needed human judgement. AEMAS was not used in
          the incident.
        </p>
        <div className="actions">
          <button className="secondary" onClick={onCaseStudy}>
            Explore Case Study
          </button>
        </div>
      </section>
    </div>
  )
}
