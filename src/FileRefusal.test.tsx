import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CASE_FILE_DOC from '../docs/CASE_FILE.md?raw'
import SAMPLE_CASE from './data/sample-case.json?raw'
import SAMPLE_CASE_URL from './data/sample-case.json?url'
import { CaseFileHelp, FileRefusal, SHOWN_ERRORS } from './FileRefusal'
import { hasFlatRecords, parseCaseFile } from './lib/casefile'
import { CASE_FILE_DOC_URL, SAMPLE_CASE_DOWNLOAD } from './site'

// A refused file gets a plain summary, guidance when its events are flat
// records, the first reasons with the rest folded away, and a known-good file
// to start from. The reader's rules do not change.

// Flat authentication records, the shape an AI tool or a log export usually
// gives: valid JSON, not a case file. Synthetic.
const flatFile = (n: number, list = false) => {
  const events = Array.from({ length: n }, (_, i) => ({
    id: `EVT-${String(i + 1).padStart(3, '0')}`,
    timestamp: `2026-11-24T07:${String(i).padStart(2, '0')}:11Z`,
    user: 'user01',
    computer: 'WS-01',
    event_type: 'authentication',
    outcome: i % 2 ? 'failure' : 'success',
  }))
  return JSON.stringify(list ? events : { events }, null, 2)
}

const refusedWith = (text: string) => {
  const parsed = parseCaseFile(text)
  if (parsed.ok) throw new Error('expected the file to be refused')
  return parsed.errors
}

const render = (text: string) =>
  renderToStaticMarkup(<FileRefusal errors={refusedWith(text)} flatRecords={hasFlatRecords(text)} />)

const items = (html: string) => html.match(/<li>/g)?.length ?? 0

// A case file with one field the format does not name: refused, not flat.
const sampleWithLabel = () => {
  const data = JSON.parse(SAMPLE_CASE)
  data.events[0].evidence.label = 'malicious'
  return JSON.stringify(data)
}

describe('FileRefusal', () => {
  it('flat JSON records are refused, and the page says what a case-file event needs', () => {
    const text = flatFile(24)
    expect(parseCaseFile(text).ok).toBe(false) // detection opens nothing
    expect(hasFlatRecords(text)).toBe(true)
    const html = render(text)
    expect(html).toContain('This file is not in the AEMAS case-file format.')
    expect(html).toContain('Nothing in it was used.')
    expect(html).toContain('Its events are flat records.')
    expect(html).toContain('<code>evidence</code>')
    expect(html).toContain('<code>provenance</code>')
  })

  it('also recognises a bare list of flat records', () => {
    const text = flatFile(3, true)
    expect(refusedWith(text)).toEqual(['the file is not a JSON object'])
    expect(hasFlatRecords(text)).toBe(true)
    expect(render(text)).toContain('Its events are flat records.')
  })

  it('gives no flat-record guidance when the events are not flat', () => {
    for (const text of [sampleWithLabel(), '{"events": []}', 'not json', '[]', '[1, 2]']) {
      expect(hasFlatRecords(text), text).toBe(false)
      expect(render(text)).not.toContain('flat records')
      expect(render(text)).toContain('This file is not in the AEMAS case-file format.')
    }
  })

  it('shows the first errors, with every other one behind “Show all”, counted from the file', () => {
    for (const n of [24, 2]) {
      const text = flatFile(n)
      const errors = refusedWith(text)
      expect(errors.length).toBeGreaterThan(SHOWN_ERRORS)
      const html = render(text)
      const [visible, folded] = html.split('<details')
      expect(items(visible)).toBe(SHOWN_ERRORS)
      expect(visible).toContain(`${errors.length} errors; the first ${SHOWN_ERRORS}:`)
      expect(folded).toContain(`Show all ${errors.length} errors`)
      expect(folded).toContain(`start="${SHOWN_ERRORS + 1}"`)
      expect(items(folded)).toBe(errors.length - SHOWN_ERRORS)
      // Every reason is listed exactly once.
      for (const error of errors) expect(html.split(`<li>${error}</li>`)).toHaveLength(2)
    }
    expect(refusedWith(flatFile(24))).toHaveLength(195) // the owner's 24-event file
  })

  it('folds nothing away when there are ten errors or fewer', () => {
    const html = render(sampleWithLabel())
    expect(html).toContain('1 error:')
    expect(items(html)).toBe(1)
    expect(html).not.toContain('<details')
  })

  it('announces the summary, not the list of reasons', () => {
    const alert = render(flatFile(24)).split('role="alert"')[1].split('</div>')[0]
    expect(alert).toContain('This file is not in the AEMAS case-file format.')
    expect(alert).not.toContain('<li>')
  })
})

describe('Case-file help', () => {
  it('downloads the sample case file, which the reader opens', () => {
    const html = renderToStaticMarkup(<CaseFileHelp />)
    expect(SAMPLE_CASE_URL).toMatch(/sample-case/)
    expect(html).toContain(`href="${SAMPLE_CASE_URL}" download="${SAMPLE_CASE_DOWNLOAD}"`)
    expect(html).toContain('Download the sample case file')
    const parsed = parseCaseFile(SAMPLE_CASE)
    expect(parsed.ok).toBe(true)
    expect(render(flatFile(24))).toContain(`download="${SAMPLE_CASE_DOWNLOAD}"`)
  })

  it('links the case-file format, whose button names match the page', () => {
    const html = renderToStaticMarkup(<CaseFileHelp />)
    expect(CASE_FILE_DOC_URL).toMatch(/^https:\/\/github\.com\/judeszn\/project-studio\/blob\/main\/docs\/CASE_FILE\.md$/)
    expect(html).toContain(`href="${CASE_FILE_DOC_URL}" target="_blank" rel="noreferrer"`)
    expect(CASE_FILE_DOC).toContain('**Use sample evidence (simulated)**')
    expect(CASE_FILE_DOC).toContain('**Download the sample case file**')
    expect(CASE_FILE_DOC).not.toContain('Try the sample investigation')
  })
})
