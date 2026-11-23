import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CaseStudy } from './CaseStudy'
import { DESCRIPTOR, HEADLINE, Overview } from './Overview'
import { SiteHeader } from './Shell'
import { FULL_NAME, NAV, TESTIMONY } from './site'

// The home page presents the product, not its implementation, and claims
// nothing it does not do. The case study keeps fact, hypothesis and limits
// apart and cites its source.

const home = () =>
  renderToStaticMarkup(
    <Overview
      notice={null}
      caseStudy={<CaseStudy />}
      busy={false}
      onStart={() => {}}
      onCaseStudy={() => {}}
      onHowVerdicts={() => {}}
    />,
  )

const text = (html: string) => html.replace(/<[^>]+>/g, ' ')

describe('Overview', () => {
  it('leads with the problem statement and the two actions', () => {
    const html = home()
    expect(html).toContain(HEADLINE)
    expect(html).toContain(DESCRIPTOR)
    expect(html).toContain('Start an Investigation')
    expect(html).toContain('Explore the Case Study')
  })

  it('spells out the name once, without claiming monitoring', () => {
    const words = text(home())
    expect(FULL_NAME).toBe('AI Event Matching and Analysis System')
    expect(words).toContain(`AEMAS (${FULL_NAME})`)
    expect(words).not.toMatch(/Monitoring/)
  })

  it('names no AI model or platform: those are implementation details', () => {
    const words = text(home())
    for (const name of ['Gemini', 'Nano', 'Firebase', 'App Check', 'Google']) {
      expect(words).not.toContain(name)
    }
  })

  it('claims no monitoring, alerting or response, and says so plainly', () => {
    const words = text(home())
    expect(words).toContain('It does not monitor systems, raise alerts or take action')
    expect(words).not.toMatch(/real-time|24\/7|live (monitoring|alerts|threat)|continuous monitoring/i)
    expect(words).not.toMatch(/Planned|coming soon/i)
  })

  it('shows no session counters or worked-example verdict counts on the home page', () => {
    const html = home()
    expect(html).not.toContain('kpi')
    expect(html).not.toContain('tiles')
    expect(html).not.toContain('findings verified')
  })
})

describe('CaseStudy', () => {
  const html = renderToStaticMarkup(<CaseStudy />)
  const words = text(html)

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
  it('offers the three main places, and marks an open case as Investigations', () => {
    const html = renderToStaticMarkup(<SiteHeader page="case" onNavigate={() => {}} />)
    expect(NAV.map((n) => n.label)).toEqual(['Overview', 'Case Study', 'Investigations'])
    for (const item of NAV) expect(html).toContain(`>${item.label}</a>`)
    expect(html).toContain('aria-current="page">Investigations</a>')
    expect(html.match(/aria-current/g)).toHaveLength(1)
    expect(html).toContain('<strong>AEMAS</strong>')
  })
})
