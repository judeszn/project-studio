import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CaseStudy } from './CaseStudy'
import DEMO_CASE from './data/sample-case.json?raw'
import { WORKED_EXAMPLE, WORKED_EXAMPLE_TEXT } from './data/worked-example'
import {
  CHECKS,
  DESCRIPTION,
  HEADLINE,
  MOTTO,
  NIST_DE_AE_02,
  NIST_RS_AN_03,
  QUALIFIER,
  STEPS,
  VERDICT_EXAMPLES,
} from './home'
import { parseCaseFile } from './lib/casefile'
import { VERDICTS, buildWorkedExample } from './lib/report'
import { LANL_FINDING_TYPES } from './lib/schema'
import { Overview } from './Overview'
import { SiteHeader } from './Shell'
import { DESCRIPTOR, FULL_NAME, NAV, SCREEN, TESTIMONY } from './site'

// The home page says what AEMAS is, how it works, shows real verdicts, and
// states the method and the standards it maps to, claiming nothing it does
// not do. The case study keeps fact, hypothesis and limits apart and cites
// its source.

const home = () =>
  renderToStaticMarkup(
    <Overview notice={null} busy={false} onStart={() => {}} onCaseStudy={() => {}} onHowVerdicts={() => {}} />,
  )

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')

// The worked example as the app checks it, through the same code as a model.
const workedExample = () => {
  const parsed = parseCaseFile(DEMO_CASE)
  if (!parsed.ok) throw new Error(parsed.errors.join('; '))
  const c = parsed.case
  return buildWorkedExample(
    { id: c.id, origin: 'demo', fileName: 'sample-case.json', sha256: 'e'.repeat(64), events: c.events.length, source: c.source },
    WORKED_EXAMPLE_TEXT,
    c.events,
    c.provenance,
    LANL_FINDING_TYPES,
  )
}

describe('Overview', () => {
  it('leads with what AEMAS is, the slogan and the two actions', () => {
    const words = text(home())
    expect(HEADLINE).toBe('Security Investigation & Event Matching')
    expect(words).toContain(HEADLINE)
    expect(words).toContain(DESCRIPTION)
    expect(words).toContain('Gemini Nano proposes. Deterministic engine verifies. The SOC decides.')
    expect(words).not.toContain('Code verifies')
    expect(words).toContain(QUALIFIER)
    expect(words).toContain('Start an Investigation')
    expect(words).toContain('Explore Case Study')
  })

  it('spells out the name once, without claiming monitoring', () => {
    const words = text(home())
    expect(FULL_NAME).toBe('AI Event Matching and Analysis System')
    expect(words).toContain(`AEMAS (${FULL_NAME})`)
    expect(words).not.toMatch(/Monitoring/)
  })

  it('names Gemini Nano without a version, and the cloud only with consent', () => {
    const words = text(home())
    expect(MOTTO[0]).toBe('Gemini Nano proposes.')
    expect(words).not.toMatch(/Nano\s*v?\d|Gemma/i)
    expect(QUALIFIER).toContain('Cloud Gemini only with your consent')
    // The platform is shown where a run is made, not here.
    for (const name of ['Firebase', 'App Check']) expect(words).not.toContain(name)
  })

  it('names the SOC as the decision maker, and no role AEMAS has no workflow for', () => {
    const words = text(home())
    expect(words).toContain('The SOC decides.')
    expect(STEPS.map((s) => s.title)).toEqual([
      'Load Evidence',
      'Inspect Events',
      'Gemini Nano Proposes',
      'Deterministic Engine Verifies',
      'SOC Decides',
    ])
    expect(words).not.toMatch(/\bHOC\b|CISO|Head of Security|analyst decides/)
  })

  it('opening a case file is described as opening, not uploading', () => {
    expect(STEPS[0].text).toContain('Open a case file')
    expect(text(home())).not.toMatch(/upload/i)
  })

  it('shows one real worked-example finding per verdict, as the verifier judges it', () => {
    const report = workedExample()
    expect(VERDICT_EXAMPLES.map((v) => v.verdict).sort()).toEqual([...VERDICTS].sort())
    const words = text(home())
    for (const { finding, verdict } of VERDICT_EXAMPLES) {
      const written = WORKED_EXAMPLE.findings[finding - 1]
      expect(report.findings[finding - 1].verdict).toBe(verdict)
      expect(words).toContain(`#${finding} “${written.claim}”`)
      expect(words).toContain(written.event_ids.join(', '))
    }
  })

  it('says what the code found in each example, as the verifier’s reasons say', () => {
    const [, , contradicted, , , missing, unchecked] = workedExample().findings
    expect(contradicted.reasons).toEqual(['E10 has outcome "success", not "denied"'])
    expect(VERDICT_EXAMPLES[1].found).toBe('E10 records a successful logon')
    expect(missing.reasons).toContain('cites event E21, which is not in the evidence')
    expect(VERDICT_EXAMPLES[2].found).toBe('E21 is not in the evidence')
    expect(unchecked.reasons).toEqual(['Type "other": no rule in code checks it.'])
    expect(VERDICT_EXAMPLES[3].found).toContain('never counted as Verified')
  })

  it('lists the checks and the evaluation as the code and the README record them', () => {
    const words = text(home())
    for (const check of CHECKS) expect(words).toContain(check)
    expect(words).toContain('none of seven failing findings was shown as Verified')
    expect(words).toContain('Single runs, not benchmarks.')
  })

  it('quotes NIST word for word, and marks RS.AN-03 as supported only in part', () => {
    const words = text(home())
    expect(NIST_DE_AE_02).toBe('Potentially adverse events are analyzed to better understand associated activities')
    expect(NIST_RS_AN_03).toBe(
      'Analysis is performed to establish what has taken place during an incident and the root cause of the incident',
    )
    expect(words).toContain(`Maps to DE.AE-02 : “${NIST_DE_AE_02}”`)
    expect(words).toContain(`Supports RS.AN-03 in part: “${NIST_RS_AN_03}”`)
    expect(words).toContain('not the root cause')
    expect(words).not.toMatch(/RS\.AN-07/)
  })

  it('maps to frameworks without claiming compliance or certification', () => {
    const words = text(home())
    for (const name of ['NIST SP 800-61 Rev. 3', 'CSF 2.0', 'SANS PICERL', 'MITRE ATT&CK']) {
      expect(words).toContain(name)
    }
    expect(words).toContain('These are references, not a certification or a compliance claim.')
    const rest = words.replace('not a certification or a compliance claim', '')
    expect(rest).not.toMatch(/complian|complies|certif|accredit/i)
  })

  it('claims no monitoring, alerting or response, and says so plainly', () => {
    const words = text(home())
    expect(words).toContain(
      'AEMAS does not monitor infrastructure, raise alerts, take action, confirm that an attack happened, or replace incident responders.',
    )
    expect(words).not.toMatch(/real-time|24\/7|live (monitoring|alerts|threat)|continuous monitoring/i)
    expect(words).not.toMatch(/Planned|coming soon/i)
  })

  it('keeps the problem story off the home page, and links to the case study instead', () => {
    const html = home()
    expect(html).not.toContain('AI can read security events quickly')
    expect(html).not.toContain('should be driven by evidence, not assumptions')
    expect(text(html)).toContain('AEMAS was not used in the incident.')
    expect(html).not.toContain('What happened') // the case study itself is its own page
  })

  it('uses no in-page anchors, which would collide with the page routes', () => {
    expect(home()).not.toMatch(/href="#/)
  })
})

describe('screen sentences', () => {
  it('one short sentence per screen, and none promises what the code does not do', () => {
    for (const sentence of Object.values(SCREEN)) {
      expect(sentence.split(' ').length).toBeLessThanOrEqual(22)
      expect(sentence).not.toMatch(/nothing is (kept|stored)|upload/i)
    }
    expect(SCREEN.investigations).toContain('no case data is saved')
    // Analysis may run on either model, so it names neither Nano nor the cloud model alone.
    expect(SCREEN.analysis).toContain('on this device or in the cloud if you allow it')
    expect(SCREEN.verdicts).toContain('with no AI involved')
  })
})

describe('CaseStudy', () => {
  const html = renderToStaticMarkup(<CaseStudy />)
  const words = text(html)

  it('is a page of its own, with its screen sentence', () => {
    expect(html).toContain('<h1 id="case-study-title">Change Healthcare cyberattack, 2024</h1>')
    expect(words).toContain(SCREEN.caseStudy)
  })

  it('has the four parts, each labelled for what it is', () => {
    for (const heading of [
      'What happened',
      'Establishing how access occurred',
      'Where AEMAS could have helped',
      'What AEMAS could not have done',
    ]) {
      expect(html).toContain(`<h3>${heading}</h3>`)
    }
    for (const tag of ['Public record', 'The investigative challenge', 'Hypothetical', 'Limits']) {
      expect(html).toContain(`>${tag}</p>`)
    }
  })

  it('states the facts the testimony gives, and cites it', () => {
    expect(words).toContain('12 February 2024')
    expect(words).toContain('compromised credentials')
    expect(words).toContain('did not have multi-factor authentication')
    expect(words).toContain('21 February')
    expect(html).toContain(`href="${TESTIMONY.url}"`)
    expect(TESTIMONY.url).toMatch(/^https:\/\/docs\.house\.gov\//)
  })

  it('says AEMAS was not used and states what it could not have done', () => {
    expect(words).toContain('AEMAS was not used in this incident')
    expect(words).toContain('holds no Change Healthcare data')
    for (const limit of ['Prevented the intrusion.', 'Detected it as it happened.', 'Established the full scope.', 'Decided what happened.']) {
      expect(words).toContain(limit)
    }
  })

  it('uses no figure it cannot source', () => {
    expect(words).not.toMatch(/million/)
  })

  it('uses no in-page anchors, which would collide with the page routes', () => {
    expect(html).not.toMatch(/href="#/)
  })
})

describe('SiteHeader', () => {
  const html = renderToStaticMarkup(<SiteHeader page="case" onNavigate={() => {}} />)

  it('offers the three main places, and marks an open case as Investigations', () => {
    expect(NAV.map((n) => n.label)).toEqual(['Overview', 'Case Study', 'Investigations'])
    for (const item of NAV) expect(html).toContain(`>${item.label}</a>`)
    expect(html).toContain('aria-current="page">Investigations</a>')
    expect(html.match(/aria-current/g)).toHaveLength(1)
  })

  it('uses the name as the logo, with the descriptor under it and no graphic mark', () => {
    expect(html).toContain('<strong class="wordmark">AEMAS</strong>')
    expect(html).toContain(`<span class="brand-sub">${DESCRIPTOR.replace('&', '&amp;')}</span>`)
    expect(html).not.toContain('class="mark"')
  })

  it('has a small, labelled light/dark switch', () => {
    expect(html).toMatch(/<button type="button" class="theme-toggle" aria-label="Switch to (dark|light) mode"/)
    expect(text(html)).not.toMatch(/Dark mode|Light mode/) // an icon, not a text button
  })
})
