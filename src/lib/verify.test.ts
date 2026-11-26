import { describe, expect, it } from 'vitest'
import { GS03_EVENTS } from '../data/gs03'
import { ATTACK_REFERENCES } from './attack'
import {
  FINDING_TYPES,
  LANL_FINDING_TYPES,
  LOGON_ACTIONS,
  incidentProposalSchema,
  lanlProposalSchema,
} from './schema'
import type { EventAction, Finding, FindingType, IncidentProposal, LogEvent } from './schema'
import {
  checkProposal,
  checkSupport,
  extractAccounts,
  extractComputers,
  extractEventIds,
  extractLanlIdentities,
  extractSecondTimes,
  extractTimes,
  parseProposal,
  verifyProposal,
} from './verify'
import { parseCaseFile } from './casefile'
import SAMPLE_CASE from '../data/sample-case.json?raw'

const finding = (type: FindingType, claim: string, ...event_ids: string[]): Finding => ({
  type,
  claim,
  event_ids,
})

const proposal = (overrides: Partial<IncidentProposal> = {}): IncidentProposal => ({
  classification: 'Credential Compromise',
  confidence: 'High',
  explanation:
    'A privileged account signed in from outside the organisation at 02:20 and the owner denies it.',
  findings: [
    finding(
      'sign_in_from_unrecognised_device',
      'adm-ops-01 signed in from an unrecognised device at 02:20',
      'E05',
    ),
    finding('account_created', 'A second administrator account was created at 02:24', 'E06'),
    finding('account_owner_statement', 'The owner says they did not sign in after 17:41', 'E11'),
  ],
  recommended_actions: ['Restrict adm-ops-01 and adm-ops-02 pending review'],
  ...overrides,
})

describe('parseProposal', () => {
  it('accepts a well-formed proposal', () => {
    expect(parseProposal(JSON.stringify(proposal()))).toEqual({ ok: true, proposal: proposal() })
  })

  it('rejects text that is not JSON', () => {
    expect(parseProposal('Here is my analysis: {...}')).toEqual({
      ok: false,
      errors: ['output is not valid JSON'],
    })
  })

  it('rejects JSON that is not an object', () => {
    expect(parseProposal('[]').ok).toBe(false)
    expect(parseProposal('null').ok).toBe(false)
  })

  it('reports every missing or mistyped field', () => {
    const result = parseProposal(JSON.stringify({ classification: 'Malware', findings: 'none' }))
    expect(result).toEqual({
      ok: false,
      errors: [
        'classification: expected one of Ransomware, Phishing, Credential Compromise, Data Exfiltration, Insider Threat, Undetermined',
        'confidence: expected one of Low, Medium, High',
        'explanation: expected a string',
        'recommended_actions: expected an array of strings',
        'findings: expected an array',
      ],
    })
  })

  it('rejects a finding whose event_ids is not an array of strings', () => {
    const bad = { ...proposal(), findings: [{ type: 'other', claim: 'Sign-in', event_ids: 'E05' }] }
    expect(parseProposal(JSON.stringify(bad))).toEqual({
      ok: false,
      errors: ['findings[0].event_ids: expected an array of strings'],
    })
  })

  it('rejects a finding with a missing or unknown type', () => {
    const expected =
      'expected one of sign_in_from_unrecognised_device, sign_in, sign_out, account_created, ' +
      'security_setting_changed, data_access_denied, data_access_succeeded, ' +
      'account_owner_statement, other'
    const bad = {
      ...proposal(),
      findings: [
        { claim: 'Sign-in', event_ids: ['E05'] },
        { type: 'data_stolen', claim: 'Data was taken', event_ids: ['E08'] },
      ],
    }
    expect(parseProposal(JSON.stringify(bad))).toEqual({
      ok: false,
      errors: [`findings[0].type: ${expected}`, `findings[1].type: ${expected}`],
    })
  })

  // Gemini Nano once wrote past Chrome's output limit; the schema now bounds
  // every list, and output over a bound is rejected whatever the model did.
  it('rejects more findings, cited events or actions than the schema allows', () => {
    const one = finding('sign_in', 'adm-ops-01 signed in at 02:20', 'E05')
    const bad = proposal({
      findings: [
        finding('other', 'Sign-ins', 'E01', 'E02', 'E05', 'E09', 'E10'),
        ...Array(8).fill(one),
      ],
      recommended_actions: Array(6).fill('Review adm-ops-01'),
    })
    expect(parseProposal(JSON.stringify(bad))).toEqual({
      ok: false,
      errors: [
        'recommended_actions: expected at most 5 items, got 6',
        'findings: expected at most 8 items, got 9',
        'findings[0].event_ids: expected at most 4 items, got 5',
      ],
    })
  })

  it('accepts lists at the bounds', () => {
    const atBounds = proposal({
      findings: [
        finding('other', 'Sign-ins', 'E01', 'E02', 'E05', 'E10'),
        ...Array(7).fill(finding('sign_in', 'adm-ops-01 signed in at 02:20', 'E05')),
      ],
      recommended_actions: Array(5).fill('Review adm-ops-01'),
    })
    expect(parseProposal(JSON.stringify(atBounds)).ok).toBe(true)
  })

  it('asks for findings before the explanation and the classification', () => {
    const order = ['findings', 'explanation', 'classification', 'confidence', 'recommended_actions']
    expect(Object.keys(incidentProposalSchema.properties)).toEqual(order)
    expect(incidentProposalSchema.required).toEqual(order)
  })

  it('rejects fields the schema does not define', () => {
    const bad = { ...proposal(), verified: true }
    expect(parseProposal(JSON.stringify(bad))).toEqual({
      ok: false,
      errors: ['verified: unexpected field'],
    })
  })
})

describe('extractTimes', () => {
  it('reads clock times and zero-pads the hour', () => {
    expect(extractTimes('Signed in at 02:20, out at 2:36')).toEqual(['02:20', '02:36'])
  })

  it('ignores other numbers', () => {
    expect(extractTimes('203.0.113.57 on 9 March, 2 accounts')).toEqual([])
  })
})

describe('extractEventIds', () => {
  it('reads event IDs and nothing else', () => {
    expect(extractEventIds('See E05 and E11; adm-ops-01 on HR-PC1')).toEqual(['E05', 'E11'])
  })
})

describe('extractAccounts', () => {
  it('reads account names once each, in lower case', () => {
    expect(extractAccounts('ADM-OPS-01 created adm-ops-02; adm-ops-01 signed out')).toEqual([
      'adm-ops-01',
      'adm-ops-02',
    ])
  })

  it('ignores devices, addresses, dates, event IDs and hyphenated words', () => {
    expect(
      extractAccounts('HR-PC1 at 203.0.113.57 on 2026-03-10, see E05: multi-factor sign-in'),
    ).toEqual([])
  })
})

describe('checkProposal', () => {
  it('finds no problem when every citation and time is in the evidence', () => {
    expect(checkProposal(proposal(), GS03_EVENTS)).toEqual([])
  })

  it('flags a finding that cites no event', () => {
    const uncited = proposal({ findings: [finding('other', 'Customer data was stolen')] })
    expect(checkProposal(uncited, GS03_EVENTS)).toEqual([
      { path: 'findings[0]', problem: 'cites no event' },
    ])
  })

  it('flags a cited event that does not exist', () => {
    const invented = proposal({
      findings: [finding('other', 'Malware was installed', 'E05', 'E42')],
    })
    expect(checkProposal(invented, GS03_EVENTS)).toEqual([
      { path: 'findings[0]', problem: 'cites event E42, which is not in the evidence' },
    ])
  })

  it('flags a time that does not belong to the cited events', () => {
    const shifted = proposal({
      findings: [finding('account_created', 'The account was created at 02:20', 'E06')],
    })
    expect(checkProposal(shifted, GS03_EVENTS)).toEqual([
      { path: 'findings[0]', problem: 'mentions 02:20, which is not a time in the events it cites' },
    ])
  })

  it('accepts a time quoted inside a cited statement', () => {
    const quoted = proposal({
      findings: [finding('account_owner_statement', 'No sign-in by the owner after 17:41', 'E11')],
    })
    expect(checkProposal(quoted, GS03_EVENTS)).toEqual([])
  })

  it('flags times and events in free text that are not in the evidence', () => {
    const invented = proposal({
      explanation: 'Activity began at 03:05, see E99.',
      recommended_actions: ['Review everything since 01:00'],
    })
    expect(checkProposal(invented, GS03_EVENTS)).toEqual([
      { path: 'explanation', problem: 'mentions event E99, which is not in the evidence' },
      { path: 'explanation', problem: 'mentions 03:05, which is not a time in the evidence' },
      { path: 'recommended_actions[0]', problem: 'mentions 01:00, which is not a time in the evidence' },
    ])
  })

  it('flags an event mentioned in a claim but not in the evidence', () => {
    const invented = proposal({
      findings: [finding('other', 'Confirmed by E77', 'E05')],
    })
    expect(checkProposal(invented, GS03_EVENTS)).toEqual([
      { path: 'findings[0]', problem: 'mentions event E77, which is not in the evidence' },
    ])
  })

  it('flags an empty explanation, no findings and an empty claim', () => {
    expect(checkProposal(proposal({ explanation: ' ', findings: [] }), GS03_EVENTS)).toEqual([
      { path: 'explanation', problem: 'empty' },
      { path: 'findings', problem: 'no findings' },
    ])
    const blank = proposal({ findings: [finding('other', '', 'E05')] })
    expect(checkProposal(blank, GS03_EVENTS)).toEqual([
      { path: 'findings[0]', problem: 'empty claim' },
    ])
  })

  it('flags an account that is not in the events a finding cites', () => {
    const wrongActor = proposal({
      findings: [finding('account_created', 'hr-user-07 created an administrator account', 'E06')],
    })
    expect(checkProposal(wrongActor, GS03_EVENTS)).toEqual([
      {
        path: 'findings[0]',
        problem: 'mentions account hr-user-07, which is not in the events it cites',
      },
    ])
  })

  it('accepts an account named as the target or in the detail of a cited event', () => {
    const named = proposal({
      findings: [
        finding('account_created', 'adm-ops-01 created adm-ops-02', 'E06'),
        finding('account_owner_statement', 'The owner denies creating adm-ops-02', 'E11'),
      ],
    })
    expect(checkProposal(named, GS03_EVENTS)).toEqual([])
  })

  it('flags an account in free text that is not in the evidence', () => {
    const invented = proposal({ recommended_actions: ['Disable adm-ops-09'] })
    expect(checkProposal(invented, GS03_EVENTS)).toEqual([
      {
        path: 'recommended_actions[0]',
        problem: 'mentions account adm-ops-09, which is not in the evidence',
      },
    ])
  })

  it('flags every citation, time and account when there is no evidence', () => {
    expect(checkProposal(proposal(), [])).toHaveLength(10)
  })
})

// LANL-shaped evidence rows, as tools/lanl/case.ts writes them. Synthetic
// identifiers in LANL's documented shapes, not taken from the dataset.
const lanlEvent = (
  id: string,
  sourceUser: string,
  destinationUser: string,
  sourceComputer: string,
  destinationComputer: string,
): LogEvent => ({
  id,
  date: 'Day 2',
  time: 'elapsed 17:54:44',
  source: 'identity',
  actor: sourceUser,
  action: 'network logon',
  target: destinationComputer,
  outcome: 'success',
  logonType: 'Network',
  detail:
    "Day 2 · elapsed 17:54:44 (dataset time 150885 s from the dataset's start; not a clock time). " +
    `Source user ${sourceUser}; destination user ${destinationUser}; ` +
    `source computer ${sourceComputer}; destination computer ${destinationComputer}; ` +
    'authentication type NTLM; logon type Network; orientation LogOn; result Success.',
})

const LANL_EVENTS: LogEvent[] = [
  lanlEvent('E01', 'U900748@DOM1', 'U900748@DOM1', 'C917693', 'C901003'),
  lanlEvent('E02', 'C900625$@DOM1', 'U900147@DOM1', 'C900625', 'C900625'), // machine account
  lanlEvent('E03', 'U900777@C900583', 'U900777@C900583', 'C917693', 'C900583'), // local account
  lanlEvent('E04', 'SYSTEM@C900653', 'SYSTEM@C900653', 'C900653', 'C900653'),
  lanlEvent('E05', 'U900582@?', 'U900582@?', 'C917693', 'C901252'), // domain not recorded
]

const lanlProposal = (claim: string, ...ids: string[]): IncidentProposal => ({
  classification: 'Undetermined',
  confidence: 'Low',
  explanation: 'Sign-ins in the evidence.',
  findings: [finding('logon', claim, ...ids)],
  recommended_actions: ['Review the logons.'],
})

const lanlProblems = (claim: string, ...ids: string[]) =>
  checkProposal(lanlProposal(claim, ...ids), LANL_EVENTS)

describe('identities', () => {
  it('reads LANL identities in the shapes the evidence uses', () => {
    expect(
      extractLanlIdentities(
        'U900748@DOM1, C900625$@DOM1, U900777@C900583 and SYSTEM@C900653; U900748, C900625$ and C917693',
      ),
    ).toEqual([
      'u900748@dom1',
      'c900625$@dom1',
      'u900777@c900583',
      'system@c900653',
      'c900583',
      'c900653',
      'u900748',
      'c900625$',
      'c917693',
    ])
  })

  it('finds no LANL-shaped identity in the GS-03 evidence', () => {
    const text = GS03_EVENTS.map((e) => `${e.actor} ${e.target} ${e.detail}`).join(' ')
    expect(extractLanlIdentities(text)).toEqual([])
  })

  describe('GS-03', () => {
    it('accepts an account in the cited event', () => {
      const ok = proposal({ findings: [finding('sign_in', 'adm-ops-01 signed in', 'E05')] })
      expect(checkProposal(ok, GS03_EVENTS)).toEqual([])
    })

    it('flags an account that is in no event', () => {
      const unknown = proposal({ findings: [finding('sign_in', 'adm-ops-07 signed in', 'E05')] })
      expect(checkProposal(unknown, GS03_EVENTS)).toEqual([
        { path: 'findings[0]', problem: 'mentions account adm-ops-07, which is not in the events it cites' },
      ])
    })
  })

  describe('LANL', () => {
    it('accepts users and computers of the cited event, in full or bare, in any case', () => {
      expect(lanlProblems('U900748@DOM1 signed in from C917693 to C901003', 'E01')).toEqual([])
      expect(lanlProblems('U900748 signed in; u900748@dom1 again', 'E01')).toEqual([])
    })

    it('accepts machine, destination, local and SYSTEM accounts of the cited event', () => {
      expect(lanlProblems('C900625$@DOM1 (C900625$) authenticated U900147@DOM1', 'E02')).toEqual([])
      expect(lanlProblems('Local account U900777@C900583 signed in to C900583', 'E03')).toEqual([])
      expect(lanlProblems('SYSTEM@C900653 signed in on C900653', 'E04')).toEqual([])
    })

    it('flags a user or computer that is in no event', () => {
      expect(lanlProblems('U900999@DOM1 signed in to C999999', 'E01')).toEqual([
        { path: 'findings[0]', problem: 'mentions account u900999@dom1, which is not in the events it cites' },
        { path: 'findings[0]', problem: 'mentions computer c999999, which is not in the events it cites' },
      ])
      // A local or SYSTEM account's domain is a computer, so it is checked too.
      expect(lanlProblems('SYSTEM@C900999 signed in', 'E04')).toEqual([
        { path: 'findings[0]', problem: 'mentions account system@c900999, which is not in the events it cites' },
        { path: 'findings[0]', problem: 'mentions computer c900999, which is not in the events it cites' },
      ])
    })

    it('flags a known user written with a domain the evidence does not give it', () => {
      expect(lanlProblems('U900748@DOM2 signed in', 'E01')).toEqual([
        { path: 'findings[0]', problem: 'mentions account u900748@dom2, which is not in the events it cites' },
      ])
    })

    describe('an account whose domain was not recorded (U…@?)', () => {
      it('is read as written, with its bare name', () => {
        expect(extractLanlIdentities('Source user U900582@?; destination user U900582@?.')).toEqual(['u900582@?'])
      })

      it('accepts it as written, or bare, from the cited event', () => {
        expect(lanlProblems('U900582@? logged on to C901252 from C917693', 'E05')).toEqual([])
        expect(lanlProblems('U900582 logged on to C901252', 'E05')).toEqual([])
      })

      it('rejects a domain the evidence does not establish', () => {
        expect(lanlProblems('U900582@DOM1 logged on to C901252', 'E05')).toEqual([
          { path: 'findings[0]', problem: 'mentions account u900582@dom1, which is not in the events it cites' },
        ])
      })

      it('rejects an unrelated account', () => {
        expect(lanlProblems('U900583@? and U900999 logged on', 'E05')).toEqual([
          { path: 'findings[0]', problem: 'mentions account u900583@?, which is not in the events it cites' },
          { path: 'findings[0]', problem: 'mentions account u900999, which is not in the events it cites' },
        ])
      })

      it('"?" is not a wildcard: it does not stand for a recorded domain, nor a recorded domain for it', () => {
        expect(lanlProblems('U900748@? logged on', 'E01')).toEqual([
          { path: 'findings[0]', problem: 'mentions account u900748@?, which is not in the events it cites' },
        ])
      })

      it('is checked against the events cited, not the whole evidence', () => {
        expect(lanlProblems('U900582 logged on', 'E01')).toEqual([
          { path: 'findings[0]', problem: 'mentions account u900582, which is not in the events it cites' },
        ])
      })

      it('passes or fails verification accordingly', () => {
        const verdict = (claim: string) =>
          verifyProposal(JSON.stringify(lanlProposal(claim, 'E05')), LANL_EVENTS, LANL_FINDING_TYPES).passes
        expect(verdict('U900582@? logged on to C901252')).toEqual([true])
        expect(verdict('U900582 logged on to C901252')).toEqual([true])
        expect(verdict('U900582@DOM1 logged on to C901252')).toEqual([false])
        expect(verdict('U900999@DOM1 logged on to C901252')).toEqual([false])
      })
    })

    it('flags an identity that is in the evidence but not in the events the finding cites', () => {
      expect(lanlProblems('U900147@DOM1 signed in to C900625', 'E01')).toEqual([
        { path: 'findings[0]', problem: 'mentions account u900147@dom1, which is not in the events it cites' },
        { path: 'findings[0]', problem: 'mentions computer c900625, which is not in the events it cites' },
      ])
    })

    it('flags an unknown identity in free text', () => {
      const invented = { ...lanlProposal('U900748 signed in', 'E01'), explanation: 'U900999 did it.' }
      expect(checkProposal(invented, LANL_EVENTS)).toEqual([
        { path: 'explanation', problem: 'mentions account u900999, which is not in the evidence' },
      ])
    })

    it('a finding naming an unknown identity does not pass verification', () => {
      const verdict = (claim: string) =>
        verifyProposal(JSON.stringify(lanlProposal(claim, 'E01')), LANL_EVENTS, LANL_FINDING_TYPES).passes
      expect(verdict('U900748@DOM1 signed in to C901003')).toEqual([true])
      expect(verdict('U900999@DOM1 signed in to C901003')).toEqual([false])
    })
  })
})

// The sample case. The claims below are the models' own, from the run records
// of 15 and 17 November 2026.
const sample = parseCaseFile(SAMPLE_CASE)
if (!sample.ok) throw new Error(sample.errors.join('; '))
const SAMPLE_EVENTS = sample.case.events
const samplePasses = (...findings: Finding[]) =>
  verifyProposal(
    JSON.stringify({ ...lanlProposal('unused'), findings }),
    SAMPLE_EVENTS,
    LANL_FINDING_TYPES,
  ).passes
const sampleProblems = (...findings: Finding[]) =>
  checkProposal({ ...lanlProposal('unused'), findings }, SAMPLE_EVENTS)

describe('extractSecondTimes', () => {
  it('reads clock times to the second and zero-pads the hour', () => {
    expect(extractSecondTimes('at 2026-03-14 09:14:52 and 9:12:04, not 09:14')).toEqual([
      '09:14:52',
      '09:12:04',
    ])
  })
})

describe('extractComputers', () => {
  it('reads computer names in capitals ending in digits, hyphenated ones whole, each once', () => {
    expect(extractComputers('WKS318 to FINSRV1 via DC1; MGMT-PC1 and Account-PC1; WKS318 again')).toEqual([
      'WKS318',
      'FINSRV1',
      'DC1',
      'MGMT-PC1',
      'ACCOUNT-PC1',
    ])
  })

  it('ignores accounts, event IDs, LANL identities, domains, status codes and addresses', () => {
    expect(
      extractComputers(
        'fin-clerk-04 in E10; U900748@DOM1 on C917693; status 0xC000006A; 10.20.4.77; NTLM; Windows event 4624',
      ),
    ).toEqual([])
  })

  it('finds a name the evidence holds in any case', () => {
    expect(extractComputers('logon to finsrv1', ['FINSRV1'])).toEqual(['FINSRV1'])
    expect(extractComputers('logon to finsrv1')).toEqual([])
  })
})

describe('computers named in a finding', () => {
  it('rejects a server the cited event does not name (Nano, 15 Nov, finding 7)', () => {
    // E16 is a denied logon to FILESRV1 from BKPSRV1.
    const claim = 'Network logon to FINSRV1 from BKPSRV1 was denied due to account restriction.'
    expect(sampleProblems(finding('denied_logon', claim, 'E16'))).toEqual([
      { path: 'findings[0]', problem: 'mentions computer FINSRV1, which is not in the events it cites' },
    ])
    expect(samplePasses(finding('denied_logon', claim, 'E16'))).toEqual([false])
  })

  it('rejects the wrong computer even when the type rule is met (Nano, 17 Nov, findings 7 and 8)', () => {
    // E03 is a service logon at BKPSRV1; E13 an interactive logon at WKS107.
    const backup = finding('logon', 'svc-backup-01 successfully logged on to FILESRV1 at 08:02:40, indicating routine backup activity.', 'E03')
    const clerk = finding('logon', 'Fin-clerk-04 performed a logon to FINSRV1 from WKS107 at 09:40:05.', 'E13')
    expect(sampleProblems(backup, clerk)).toEqual([
      { path: 'findings[0]', problem: 'mentions computer FILESRV1, which is not in the events it cites' },
      { path: 'findings[1]', problem: 'mentions computer FINSRV1, which is not in the events it cites' },
    ])
    expect(samplePasses(backup, clerk)).toEqual([false, false])
    expect(checkSupport({ ...lanlProposal('unused'), findings: [backup, clerk] }, SAMPLE_EVENTS).map((s) => s.status)).toEqual([
      'supported',
      'supported',
    ])
  })

  it('accepts computers the cited events name, as target, source or in the detail, in any case', () => {
    const right = [
      finding('denied_logon', 'Network logon to FILESRV1 from BKPSRV1 was denied due to account restriction.', 'E16'),
      finding('logon', 'Successful network logon for fin-clerk-04 from workstation WKS318 at 2026-03-14 09:14:52.', 'E10'),
      finding('logon', 'fin-clerk-04 logged on interactively at wks107 at 09:40:05.', 'E13'),
    ]
    expect(sampleProblems(...right)).toEqual([])
    expect(samplePasses(...right)).toEqual([true, true, true])
  })

  it('rejects a computer that is in no event', () => {
    expect(sampleProblems(finding('logon', 'fin-clerk-04 logged on to FINSRV2 at 09:14:52.', 'E10'))).toEqual([
      { path: 'findings[0]', problem: 'mentions computer FINSRV2, which is not in the events it cites' },
    ])
  })

  it('leaves GS-03 device names to the evidence they appear in', () => {
    const ok = proposal({ findings: [finding('sign_in', 'adm-ops-01 signed in from MGMT-PC1', 'E01')] })
    expect(checkProposal(ok, GS03_EVENTS)).toEqual([])
    const wrong = proposal({ findings: [finding('sign_in', 'adm-ops-01 signed in from HR-PC1', 'E01')] })
    expect(checkProposal(wrong, GS03_EVENTS)).toEqual([
      { path: 'findings[0]', problem: 'mentions computer HR-PC1, which is not in the events it cites' },
    ])
  })

  it('leaves LANL domains to the account check', () => {
    expect(lanlProblems('U900582@DOM1 logged on to C901252', 'E05')).toEqual([
      { path: 'findings[0]', problem: 'mentions account u900582@dom1, which is not in the events it cites' },
    ])
    expect(lanlProblems('U900748 of domain DOM1 signed in to C901003', 'E01')).toEqual([])
  })
})

describe('times quoted to the second', () => {
  it('rejects seconds that differ from the cited event, though the minute matches (Nano, 17 Nov, finding 2)', () => {
    // E09 is at 09:14:10; 09:14:52 is E10, which the finding does not cite.
    const claim = 'Fin-clerk-04 successfully logged on to FINSRV1 at 09:14:52, after several failed attempts.'
    expect(sampleProblems(finding('denied_logon', claim, 'E06', 'E07', 'E08', 'E09'))).toEqual([
      { path: 'findings[0]', problem: 'mentions 09:14:52, which is not a time in the events it cites' },
    ])
  })

  it('accepts exact seconds, dated or not, and still checks a time quoted to the minute', () => {
    const exact = finding(
      'denied_logon',
      'Repeated denied network logons for fin-clerk-04 due to bad passwords at 2026-03-14 09:12:04, 2026-03-14 09:12:31, and 09:13:02.',
      'E06',
      'E07',
      'E08',
    )
    expect(sampleProblems(exact)).toEqual([])
    expect(samplePasses(exact)).toEqual([true])
    expect(sampleProblems(finding('denied_logon', 'Denied logons from 09:12 to 09:14.', 'E06', 'E09'))).toEqual([])
    expect(sampleProblems(finding('denied_logon', 'A denied logon at 09:15.', 'E09'))).toEqual([
      { path: 'findings[0]', problem: 'mentions 09:15, which is not a time in the events it cites' },
    ])
  })

  it('reports a wrong time quoted to the second once', () => {
    expect(sampleProblems(finding('denied_logon', 'A denied logon at 09:15:10.', 'E09'))).toEqual([
      { path: 'findings[0]', problem: 'mentions 09:15:10, which is not a time in the events it cites' },
    ])
  })

  it('reads LANL elapsed times to the second', () => {
    expect(lanlProblems('U900748@DOM1 signed in at elapsed 17:54:44', 'E01')).toEqual([])
    expect(lanlProblems('U900748@DOM1 signed in at elapsed 17:54:45', 'E01')).toEqual([
      { path: 'findings[0]', problem: 'mentions 17:54:45, which is not a time in the events it cites' },
    ])
  })
})

// The exact schema the page sent to Gemini Nano and the cloud model for GS-03
// before finding types became source-specific (captured 2026-11-11).
const GS03_SCHEMA_BEFORE = 
  '{"type":"object","additionalProperties":false,"required":["findings","explanation","classification","confidence","recommended_actions"],"properties":{"findings":{"type":"array","maxItems":8,"items":{"type":"object","additionalProperties":false,"required":["type","claim","event_ids"],"properties":{"type":{"type":"string","enum":["sign_in_from_unrecognised_device","sign_in","sign_out","account_created","security_setting_changed","data_access_denied","data_access_succeeded","account_owner_statement","other"]},"claim":{"type":"string"},"event_ids":{"type":"array","maxItems":4,"items":{"type":"string"}}}}},"explanation":{"type":"string"},"classification":{"type":"string","enum":["Ransomware","Phishing","Credential Compromise","Data Exfiltration","Insider Threat","Undetermined"]},"confidence":{"type":"string","enum":["Low","Medium","High"]},"recommended_actions":{"type":"array","maxItems":5,"items":{"type":"string"}}}}'

describe('finding types by evidence source', () => {
  it('GS-03 keeps exactly its nine finding types and its model schema', () => {
    expect(FINDING_TYPES).toEqual([
      'sign_in_from_unrecognised_device',
      'sign_in',
      'sign_out',
      'account_created',
      'security_setting_changed',
      'data_access_denied',
      'data_access_succeeded',
      'account_owner_statement',
      'other',
    ])
    expect(JSON.stringify(incidentProposalSchema)).toBe(GS03_SCHEMA_BEFORE)
  })

  it('the LANL model schema offers only logon, denied_logon and other', () => {
    expect(LANL_FINDING_TYPES).toEqual(['logon', 'denied_logon', 'other'])
    expect(lanlProposalSchema.properties.findings.items.properties.type.enum).toEqual([
      'logon',
      'denied_logon',
      'other',
    ])
    // Everything else in the two schemas is the same.
    const withoutTypes = (schema: object) =>
      JSON.stringify(schema).replace(/"type":\{"type":"string","enum":\[[^\]]*\]\}/, '')
    expect(withoutTypes(lanlProposalSchema)).toBe(withoutTypes(incidentProposalSchema))
  })

  it('each source accepts only its own types', () => {
    const answer = (type: FindingType) =>
      JSON.stringify(proposal({ findings: [finding(type, 'x', 'E01')] }))
    expect(parseProposal(answer('logon')).ok).toBe(false)
    expect(parseProposal(answer('denied_logon')).ok).toBe(false)
    expect(parseProposal(answer('logon'), LANL_FINDING_TYPES).ok).toBe(true)
    expect(parseProposal(answer('denied_logon'), LANL_FINDING_TYPES).ok).toBe(true)
    expect(parseProposal(answer('other'), LANL_FINDING_TYPES).ok).toBe(true)
    for (const type of FINDING_TYPES.filter((t) => t !== 'other')) {
      expect(parseProposal(answer(type), LANL_FINDING_TYPES).ok, type).toBe(false)
    }
  })

  it('an other finding on LANL evidence gets every check and never passes', () => {
    const other = (claim: string, ...ids: string[]) =>
      JSON.stringify({ ...lanlProposal(claim, ...ids), findings: [finding('other', claim, ...ids)] })
    const verify = (raw: string) => verifyProposal(raw, LANL_EVENTS, LANL_FINDING_TYPES)

    const clean = verify(other('U900748@DOM1 logged on to C901003', 'E01'))
    expect(clean.problems).toEqual([])
    expect(clean.support).toEqual([{ status: 'unchecked', notes: [] }])
    expect(clean.passes).toEqual([false])

    // Identity, time and citation checks apply to it as to any finding.
    expect(verify(other('U900999@DOM1 at 03:00, see E09', 'E01', 'E42')).problems).toEqual([
      { path: 'findings[0]', problem: 'cites event E42, which is not in the evidence' },
      { path: 'findings[0]', problem: 'mentions event E09, which is not in the evidence' },
      { path: 'findings[0]', problem: 'mentions 03:00, which is not a time in the events it cites' },
      { path: 'findings[0]', problem: 'mentions account u900999@dom1, which is not in the events it cites' },
    ])

    // And so does the repeat check.
    const twice = JSON.stringify({
      ...lanlProposal('x', 'E01'),
      findings: [finding('other', 'a', 'E01'), finding('other', 'b', 'E01')],
    })
    expect(verify(twice).problems).toEqual([{ path: 'findings[1]', problem: 'repeats finding 1' }])
  })
})

describe('logon rule', () => {
  const event = (action: EventAction, outcome: LogEvent['outcome'] = 'success'): LogEvent => ({
    ...LANL_EVENTS[0],
    action,
    outcome,
  })
  const supportFor = (type: FindingType, e: LogEvent) =>
    checkSupport({ ...lanlProposal('x', e.id), findings: [finding(type, 'x', e.id)] }, [e])[0]

  it('accepts a successful logon of every logon type', () => {
    for (const action of LOGON_ACTIONS) {
      expect(supportFor('logon', event(action)).status, action).toBe('supported')
    }
  })

  it('a failed logon contradicts a logon finding', () => {
    expect(supportFor('logon', event('network logon', 'denied'))).toEqual({
      status: 'contradicted',
      notes: ['E01 has outcome "denied", not "success"'],
    })
  })

  it('logoffs, tickets, AuthMap and screen events are not logons', () => {
    for (const action of ['logoff', 'service ticket', 'ticket-granting ticket', 'AuthMap', 'ScreenLock', 'ScreenUnlock'] as const) {
      expect(supportFor('logon', event(action))).toEqual({
        status: 'unsupported',
        notes: [`E01 is a "${action}" event, not a logon`],
      })
    }
  })

  it('a LANL logon is not a sign-in, and a GS-03 sign-in is not a LANL logon', () => {
    expect(supportFor('sign_in', event('interactive logon')).status).toBe('unsupported')
    const gs03SignIn = GS03_EVENTS.find((e) => e.id === 'E05')!
    expect(supportFor('logon', gs03SignIn).status).toBe('unsupported')
  })
})

// Owner's rule, 2026-11-12: supported only by cited logons the evidence
// records as denied. Never a successful authentication.
describe('denied_logon rule', () => {
  const event = (id: string, action: EventAction, outcome: LogEvent['outcome']): LogEvent => ({
    ...LANL_EVENTS[0],
    id,
    action,
    outcome,
  })
  const DENIED = event('E01', 'network logon', 'denied')
  const DENIED_TOO = event('E02', 'interactive logon', 'denied')
  const SUCCESS = event('E03', 'network logon', 'success')
  const DENIED_TICKET = event('E04', 'service ticket', 'denied')
  const EVENTS = [DENIED, DENIED_TOO, SUCCESS, DENIED_TICKET]

  const supportFor = (type: FindingType, ...ids: string[]) =>
    checkSupport({ ...lanlProposal('x', ...ids), findings: [finding(type, 'x', ...ids)] }, EVENTS)[0]
  const verdict = (type: FindingType, claim: string, ...ids: string[]) =>
    verifyProposal(
      JSON.stringify({ ...lanlProposal(claim, ...ids), findings: [finding(type, claim, ...ids)] }),
      EVENTS,
      LANL_FINDING_TYPES,
    )

  it('accepts a denied logon of every logon type', () => {
    for (const action of LOGON_ACTIONS) {
      const e = event('E01', action, 'denied')
      const support = checkSupport(
        { ...lanlProposal('x', 'E01'), findings: [finding('denied_logon', 'x', 'E01')] },
        [e],
      )[0]
      expect(support.status, action).toBe('supported')
    }
  })

  it('is supported only when every cited event is a denied logon', () => {
    expect(supportFor('denied_logon', 'E01', 'E02')).toEqual({ status: 'supported', notes: [] })
  })

  it('a successful logon contradicts it, alone or beside denied ones', () => {
    expect(supportFor('denied_logon', 'E03')).toEqual({
      status: 'contradicted',
      notes: ['E03 has outcome "success", not "denied"'],
    })
    expect(supportFor('denied_logon', 'E01', 'E03').status).toBe('contradicted')
  })

  it('a denied logon contradicts a logon finding, so a denial is never counted as access', () => {
    expect(supportFor('logon', 'E01')).toEqual({
      status: 'contradicted',
      notes: ['E01 has outcome "denied", not "success"'],
    })
    expect(supportFor('logon', 'E03', 'E01').status).toBe('contradicted')
  })

  it('denied tickets, logoffs, AuthMap and screen events are not denied logons', () => {
    expect(supportFor('denied_logon', 'E04')).toEqual({
      status: 'unsupported',
      notes: ['E04 is a "service ticket" event, not a logon'],
    })
    for (const action of ['logoff', 'ticket-granting ticket', 'AuthMap', 'ScreenLock', 'ScreenUnlock'] as const) {
      const e = event('E01', action, 'denied')
      const support = checkSupport(
        { ...lanlProposal('x', 'E01'), findings: [finding('denied_logon', 'x', 'E01')] },
        [e],
      )[0]
      expect(support.status, action).toBe('unsupported')
    }
  })

  it('a missing or uncited event gives no support', () => {
    expect(supportFor('denied_logon', 'E99').status).toBe('unsupported')
    expect(supportFor('denied_logon', 'E01', 'E99').status).toBe('unsupported')
    expect(supportFor('denied_logon').status).toBe('unsupported')
  })

  it('a GS-03 denied read is not a denied logon', () => {
    const deniedRead = GS03_EVENTS.find((e) => e.action === 'read' && e.outcome === 'denied')!
    const support = checkSupport(
      { ...lanlProposal('x', deniedRead.id), findings: [finding('denied_logon', 'x', deniedRead.id)] },
      GS03_EVENTS,
    )[0]
    expect(support.status).toBe('unsupported')
  })

  it('passes verification on denied logons, covers them, and fails on anything else', () => {
    const pass = verdict('denied_logon', 'U900748@DOM1 was denied a logon to C901003', 'E01', 'E02')
    expect(pass.passes).toEqual([true])
    expect(pass.covered).toEqual(['E01', 'E02'])
    expect(verdict('denied_logon', 'U900748@DOM1 was denied', 'E03').passes).toEqual([false])
    expect(verdict('denied_logon', 'U900748@DOM1 was denied', 'E01', 'E03').covered).toEqual([])
    // The identity check applies as to any finding.
    expect(verdict('denied_logon', 'U900999@DOM1 was denied', 'E01').passes).toEqual([false])
  })

  it('has no ATT&CK reference: a denial is not shown as adversary activity', () => {
    expect(ATTACK_REFERENCES.denied_logon).toBeNull()
    expect(ATTACK_REFERENCES.logon).toBeNull()
  })
})

describe('checkSupport', () => {
  const supportOf = (...findings: Finding[]) => checkSupport(proposal({ findings }), GS03_EVENTS)

  it('supports findings whose cited events are what the type says', () => {
    expect(
      supportOf(
        finding('sign_in_from_unrecognised_device', 'Sign-in from an unknown device', 'E05'),
        finding('account_created', 'New administrator account', 'E06'),
        finding('security_setting_changed', 'Sign-in alerts disabled', 'E07'),
        finding('data_access_denied', 'Read of customer data was denied', 'E08'),
        finding('account_owner_statement', 'Owner denies the activity', 'E11'),
      ),
    ).toEqual(Array(5).fill({ status: 'supported', notes: [] }))
  })

  // From runs B and D, 2026-11-11 (Gemini Nano, both schemas): a sign-out
  // cited as a sign-in. One wrong citation leaves the whole finding unsupported.
  it('does not support a sign-in finding that cites a sign-out', () => {
    expect(
      supportOf(
        finding(
          'sign_in_from_unrecognised_device',
          'Unrecognized device login by adm-ops-01',
          'E05',
          'E09',
        ),
      ),
    ).toEqual([{ status: 'unsupported', notes: ['E09 is a "sign-out" event, not "sign-in"'] }])
  })

  it('supports sign-in and sign-out findings only on events of that kind', () => {
    expect(
      supportOf(
        finding('sign_in', 'adm-ops-01 signed in at 02:20', 'E05'),
        finding('sign_out', 'adm-ops-01 signed out at 02:36', 'E09'),
        finding('sign_in', 'adm-ops-01 signed in at 02:36', 'E09'),
        finding('sign_out', 'adm-ops-01 signed out at 02:20', 'E05'),
      ),
    ).toEqual([
      { status: 'supported', notes: [] },
      { status: 'supported', notes: [] },
      { status: 'unsupported', notes: ['E09 is a "sign-out" event, not "sign-in"'] },
      { status: 'unsupported', notes: ['E05 is a "sign-in" event, not "sign-out"'] },
    ])
  })

  it('never reads the denied read of customer data as a successful one', () => {
    expect(supportOf(finding('data_access_succeeded', 'Customer data was accessed', 'E08'))).toEqual([
      { status: 'contradicted', notes: ['E08 has outcome "denied", not "success"'] },
    ])
  })

  it('contradicts an unrecognised-device finding that cites a managed device', () => {
    expect(
      supportOf(finding('sign_in_from_unrecognised_device', 'Suspicious sign-in', 'E01')),
    ).toEqual([{ status: 'contradicted', notes: ['E01 has device "managed", not "unrecognised"'] }])
  })

  it('does not support a finding that cites a different kind of event', () => {
    expect(supportOf(finding('account_created', 'A new account was created', 'E07'))).toEqual([
      {
        status: 'unsupported',
        notes: ['E07 is a "change security setting" event, not "create account"'],
      },
    ])
  })

  it('reports a contradiction ahead of other faults in the same finding', () => {
    expect(
      supportOf(finding('data_access_succeeded', 'Data was read after sign-in', 'E05', 'E08')),
    ).toEqual([
      {
        status: 'contradicted',
        notes: ['E05 is a "sign-in" event, not "read"', 'E08 has outcome "denied", not "success"'],
      },
    ])
  })

  it('never supports a finding with no citation or a citation that is not in the evidence', () => {
    expect(
      supportOf(
        finding('account_created', 'A new account was created'),
        finding('account_created', 'A new account was created', 'E42'),
        finding('account_created', 'A new account was created', 'E06', 'E42'),
      ),
    ).toEqual(Array(3).fill({ status: 'unsupported', notes: [] }))
  })

  it('does not support a device claim when the event records no device', () => {
    const noDevice: LogEvent[] = GS03_EVENTS.map((event) => ({ ...event, device: undefined }))
    const signIn = proposal({
      findings: [finding('sign_in_from_unrecognised_device', 'Suspicious sign-in', 'E05')],
    })
    expect(checkSupport(signIn, noDevice)).toEqual([
      { status: 'unsupported', notes: ['E05 has device "not recorded", not "unrecognised"'] },
    ])
  })

  it('leaves a finding of type other unchecked, never supported', () => {
    expect(supportOf(finding('other', 'The attacker covered their tracks', 'E07'))).toEqual([
      { status: 'unchecked', notes: [] },
    ])
  })
})

describe('verifyProposal', () => {
  it('skips content checks when the output does not parse', () => {
    expect(verifyProposal('not json', GS03_EVENTS)).toEqual({
      parse: { ok: false, errors: ['output is not valid JSON'] },
      problems: [],
      support: [],
      passes: [],
      covered: [],
      uncited: [],
    })
  })

  it('runs the content checks on a parsed proposal', () => {
    const raw = JSON.stringify(
      proposal({ findings: [finding('data_access_succeeded', 'Data left the network at 02:31')] }),
    )
    const result = verifyProposal(raw, GS03_EVENTS)
    expect(result.parse.ok).toBe(true)
    expect(result.problems).toEqual([
      { path: 'findings[0]', problem: 'cites no event' },
      { path: 'findings[0]', problem: 'mentions 02:31, which is not a time in the events it cites' },
    ])
    expect(result.support).toEqual([{ status: 'unsupported', notes: [] }])
  })

  // The first recorded run, 2026-11-11, with the type each finding would now
  // carry. Its findings were sound; its explanation called E09 a sign-in.
  it('flags an explanation that leans on an event no supported finding cites', () => {
    const raw = JSON.stringify(
      proposal({
        explanation:
          'The sign-in from an unrecognized device (E05 & E09) without a multi-factor ' +
          'challenge, coupled with the subsequent creation of a new administrator account ' +
          '(E06) and the disabling of security alerts (E07) raises concern. An attempt to ' +
          'read customer data was denied (E08).',
        findings: [
          finding('sign_in_from_unrecognised_device', 'Suspicious sign-in from unrecognized device.', 'E05'),
          finding('account_created', 'Creation of a new administrator account.', 'E06'),
          finding('security_setting_changed', 'Disabling administrator sign-in alerts.', 'E07'),
          finding('data_access_denied', 'Attempt to read customer data denied.', 'E08'),
          finding('account_owner_statement', 'Contradictory statement from account owner.', 'E11'),
        ],
      }),
    )
    const result = verifyProposal(raw, GS03_EVENTS)
    expect(result.support.map((s) => s.status)).toEqual(Array(5).fill('supported'))
    expect(result.problems).toEqual([
      { path: 'explanation', problem: 'mentions event E09, which no supported finding cites' },
    ])
  })

  it('does not let an explanation lean on an unsupported or unchecked finding', () => {
    const raw = JSON.stringify(
      proposal({
        explanation: 'Customer data was read (E08) and tracks were covered (E07).',
        findings: [
          finding('data_access_succeeded', 'Customer data was read', 'E08'),
          finding('other', 'Tracks were covered', 'E07'),
        ],
      }),
    )
    expect(verifyProposal(raw, GS03_EVENTS).problems).toEqual([
      { path: 'explanation', problem: 'mentions event E08, which no supported finding cites' },
      { path: 'explanation', problem: 'mentions event E07, which no supported finding cites' },
    ])
  })
})

describe('GS-03 evidence', () => {
  it('has unique event IDs in chronological order', () => {
    const ids = GS03_EVENTS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    const stamps = GS03_EVENTS.map((e) => `${e.date} ${e.time}`)
    expect([...stamps].sort()).toEqual(stamps)
  })

  it('records one read of customer data, and it was denied', () => {
    const reads = GS03_EVENTS.filter((e) => e.action === 'read')
    expect(reads.map((e) => [e.id, e.outcome])).toEqual([['E08', 'denied']])
  })
})

// Runs G and I, 2026-11-11: Gemini Nano, current schema and prompt, findings
// as returned.
const RUN_G: Finding[] = [
  finding(
    'sign_in_from_unrecognised_device',
    'adm-ops-01 signed in from an unrecognized device (203.0.113.57) without MFA on 2026-03-10 02:20',
    'E05',
  ),
  finding(
    'account_created',
    'A new account (adm-ops-02) was created given the administrator role on 2026-03-10 02:20',
    'E06',
  ),
  finding(
    'security_setting_changed',
    'The administrator sign-in alerts setting was disabled on 2026-03-10 02:27',
    'E07',
  ),
  finding(
    'data_access_denied',
    'adm-ops-01 attempted to read from the customer-data repository but was denied access because the account was not in the data-access group on 2026-03-10 02:31',
    'E08',
  ),
  finding('sign_out', 'adm-ops-01 signed out of the admin console on 2026-03-09 17:41', 'E03'),
  ...Array<Finding>(3).fill(
    finding(
      'sign_in',
      'adm-ops-01 signed in to the admin console from an unrecognized device (203.0.113.57) without MFA on 2026-03-10 02:20',
      'E05',
    ),
  ),
]

const RUN_I: Finding[] = [
  finding(
    'sign_in_from_unrecognised_device',
    'adm-ops-01 signed in from an unrecognized device (203.0.113.57) without multi-factor authentication on 2026-03-10 02:20',
    'E05',
  ),
  finding(
    'account_created',
    'A new account, adm-ops-02, was created and granted administrator role on 2026-03-10 02:20',
    'E06',
  ),
  finding(
    'security_setting_changed',
    'The administrator sign-in alerts setting was changed from enabled to disabled on 2026-03-10 02:27',
    'E07',
  ),
  finding(
    'data_access_denied',
    'adm-ops-01 attempted to read customer data but was denied access because the account was not in the data-access group on 2026-03-10 02:31',
    'E08',
  ),
  finding('sign_out', 'adm-ops-01 signed out of the admin console on 2026-03-09 17:41', 'E03'),
  finding('sign_in', 'adm-ops-01 signed in to the admin console on 2026-03-09 08:02', 'E01'),
  finding('sign_in', 'adm-ops-01 signed in to the admin console on 2026-03-10 02:20', 'E05'),
  finding('sign_out', 'adm-ops-01 signed out of the admin console on 2026-03-10 02:20', 'E09'),
]

describe('repeats, verdicts and coverage', () => {
  const verify = (findings: Finding[]) =>
    verifyProposal(JSON.stringify(proposal({ findings })), GS03_EVENTS)
  const findingProblems = (v: ReturnType<typeof verify>) =>
    v.problems.filter((p) => p.path.startsWith('findings['))

  it('run G: flags the repeated sign-ins, and four of eight findings pass', () => {
    const v = verify(RUN_G)
    expect(findingProblems(v)).toEqual([
      { path: 'findings[1]', problem: 'mentions 02:20, which is not a time in the events it cites' },
      { path: 'findings[5]', problem: 'repeats finding 1 in a less specific form' },
      { path: 'findings[6]', problem: 'repeats finding 6' },
      { path: 'findings[7]', problem: 'repeats finding 6' },
    ])
    expect(v.support.every((s) => s.status === 'supported')).toBe(true)
    expect(v.passes).toEqual([true, false, true, true, true, false, false, false])
    expect(v.covered).toEqual(['E03', 'E05', 'E07', 'E08'])
    expect(v.uncited).toEqual(['E01', 'E02', 'E04', 'E09', 'E10', 'E11'])
  })

  it('run I: flags the generic repeat and the sign-out at the wrong time', () => {
    const v = verify(RUN_I)
    expect(findingProblems(v)).toEqual([
      { path: 'findings[1]', problem: 'mentions 02:20, which is not a time in the events it cites' },
      { path: 'findings[7]', problem: 'mentions 02:20, which is not a time in the events it cites' },
      { path: 'findings[6]', problem: 'repeats finding 1 in a less specific form' },
    ])
    expect(v.passes).toEqual([true, false, true, true, true, true, false, false])
    expect(v.covered).toEqual(['E01', 'E03', 'E05', 'E07', 'E08'])
    expect(v.uncited).toEqual(['E02', 'E04', 'E10', 'E11'])
  })

  it('does not count a generic finding as a repeat when the specific one is unsupported', () => {
    const v = verify([
      finding('sign_in_from_unrecognised_device', 'Unrecognized device login by adm-ops-01', 'E05', 'E09'),
      finding('sign_in', 'adm-ops-01 signed in at 02:20', 'E05'),
    ])
    expect(findingProblems(v)).toEqual([])
    expect(v.passes).toEqual([false, true])
  })

  it('treats the same events in another order as a repeat', () => {
    const v = verify([
      finding('other', 'Activity by adm-ops-01', 'E05', 'E06'),
      finding('other', 'Activity by adm-ops-01', 'E06', 'E05'),
    ])
    expect(findingProblems(v)).toEqual([{ path: 'findings[1]', problem: 'repeats finding 1' }])
  })

  it('never passes an unchecked finding, even with no problem', () => {
    const v = verify([finding('other', 'The owner denies the activity', 'E11')])
    expect(findingProblems(v)).toEqual([])
    expect(v.passes).toEqual([false])
    expect(v.covered).toEqual([])
  })
})
