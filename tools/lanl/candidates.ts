import type { AuthRecord } from './auth'
import { datasetDayAndTime } from './case'

// The frozen case selector (docs/SELECTOR_SPEC.md). It ranks windows of the
// authentication file, one computer in one dataset hour, by first-seen
// account-to-computer pairs, and picks the evaluation case and its control.
//
// It reads authentication records only. Like auth.ts and case.ts it must
// never import the red-team labels (isolation.test.ts).

export interface SelectorRule {
  firstHour: number // earlier hours are excluded, but still form pairs
  minEvents: number
  maxEvents: number
  top: number
}

export const SELECTOR: SelectorRule = { firstHour: 168, minEvents: 5, maxEvents: 50, top: 10 }

export type AccountType = 'user' | 'machine' | 'other'

// For reporting only: every account counts towards the score.
export const accountType = (account: string): AccountType =>
  /^U\d+@/.test(account) ? 'user' : /^C\d+\$@/.test(account) ? 'machine' : 'other'

export const hourOf = (time: number) => Math.floor((time - 1) / 3600)

type Counts = Record<string, number>

export interface Candidate {
  computer: string
  hour: number
  start: number // first and last second of the hour: the case builder's window
  end: number
  when: string
  evidence: number // records naming the computer as source or destination
  outgoing: number // of those, records whose source computer it is
  score: number
  scoreByAccountType: Record<AccountType, number>
  destinations: number // distinct destination computers of outgoing records
  accounts: number // distinct accounts in the evidence
  orientations: Counts
  outcomes: Counts
  logonTypes: Counts
}

export interface Control {
  computer: string
  hour: number
  start: number
  end: number
  when: string
  evidence: number
  score: 0
  sizeDifference: number // control evidence minus the evaluation case's
  sameComputer: boolean
  // Hours from firstHour on in which the evaluation computer had records and
  // score 0: what the control was chosen from.
  scoreZeroHoursOfEvaluationComputer: number
}

export interface ScanResult {
  rule: SelectorRule
  records: number
  hours: number // dataset hours spanned by the file
  pairs: number // distinct (account, destination computer) pairs in the file
  pairsBeforeFirstHour: number
  // Windows from firstHour on that have at least one record.
  windows: { total: number; scoreZero: number; scored: number; tooSmall: number; tooLarge: number; eligible: number }
  scoreDistribution: Counts // eligible windows by score
  top: Candidate[]
  evaluation: Candidate | null
  control: Control | null
  warnings: string[]
}

interface Window {
  computer: string
  evidence: number
  outgoing: number
  score: number
  byType: Record<AccountType, number>
  // Dropped once the window is too large to be eligible.
  detail: {
    destinations: Set<string>
    accounts: Set<string>
    orientations: Counts
    outcomes: Counts
    logonTypes: Counts
  } | null
}

const place = (hour: number) => {
  const start = hour * 3600 + 1
  const { date, time } = datasetDayAndTime(start)
  return { hour, start, end: start + 3599, when: `${date} · ${time}` }
}

const count = (counts: Counts, value: string | null) => {
  const key = value ?? '?'
  counts[key] = (counts[key] ?? 0) + 1
}

// Rank order: score, then distinct destinations, then earlier hour, then
// computer name in plain string order.
export const rankOrder = (a: Candidate, b: Candidate) =>
  b.score - a.score ||
  b.destinations - a.destinations ||
  a.hour - b.hour ||
  (a.computer < b.computer ? -1 : a.computer > b.computer ? 1 : 0)

// A list of whole numbers that grows, at a few bytes each: there is one
// score-0 window per active computer per hour, millions in the real file.
function numbers<T extends Uint16Array | Uint32Array>(make: (length: number) => T) {
  let values = make(1 << 16)
  let length = 0
  return {
    push(v: number) {
      if (length === values.length) {
        const grown = make(length * 2)
        grown.set(values)
        values = grown
      }
      values[length++] = v
    },
    at: (i: number) => values[i],
  }
}

// Records must be added in file order. Times never decrease in the real file
// (inventory); the scan stops if one does, since hours are closed as they pass.
export function createScan(rule: SelectorRule = SELECTOR) {
  // Destination computer -> accounts that have authenticated to it so far.
  const seen = new Map<string, Set<string>>()
  const accountNames = new Map<string, string>()
  let pairs = 0
  let pairsBeforeFirstHour = 0
  let records = 0
  let lastTime = 0
  let hour = -1
  let open = new Map<string, Window>()

  const top: Candidate[] = []
  const scoreDistribution: Counts = {}
  const windows = { total: 0, scoreZero: 0, scored: 0, tooSmall: 0, tooLarge: 0, eligible: 0 }

  // Score-0 windows, for the control: computer, hour and evidence size.
  const computerIds = new Map<string, number>()
  const computerNames: string[] = []
  const quiet = {
    computer: numbers((n) => new Uint32Array(n)),
    hour: numbers((n) => new Uint16Array(n)),
    evidence: numbers((n) => new Uint32Array(n)),
    length: 0,
  }
  const idOf = (computer: string) => {
    let id = computerIds.get(computer)
    if (id === undefined) {
      id = computerNames.push(computer) - 1
      computerIds.set(computer, id)
    }
    return id
  }

  const firstSeen = (accounts: Set<string>, account: string) => {
    if (accounts.has(account)) return false
    // One string per account, however many computers it reaches.
    let name = accountNames.get(account)
    if (name === undefined) accountNames.set(account, (name = account))
    accounts.add(name)
    pairs++
    return true
  }

  const closeHour = () => {
    for (const w of open.values()) {
      windows.total++
      if (w.score === 0) {
        windows.scoreZero++
        quiet.computer.push(idOf(w.computer))
        quiet.hour.push(hour)
        quiet.evidence.push(w.evidence)
        quiet.length++
        continue
      }
      windows.scored++
      if (w.evidence < rule.minEvents) windows.tooSmall++
      else if (w.evidence > rule.maxEvents || !w.detail) windows.tooLarge++
      else {
        windows.eligible++
        scoreDistribution[w.score] = (scoreDistribution[w.score] ?? 0) + 1
        const candidate: Candidate = {
          computer: w.computer,
          ...place(hour),
          evidence: w.evidence,
          outgoing: w.outgoing,
          score: w.score,
          scoreByAccountType: w.byType,
          destinations: w.detail.destinations.size,
          accounts: w.detail.accounts.size,
          orientations: w.detail.orientations,
          outcomes: w.detail.outcomes,
          logonTypes: w.detail.logonTypes,
        }
        if (top.length < rule.top || rankOrder(candidate, top[top.length - 1]) < 0) {
          top.push(candidate)
          top.sort(rankOrder)
          if (top.length > rule.top) top.pop()
        }
      }
    }
    open = new Map()
  }

  const windowOf = (computer: string) => {
    let w = open.get(computer)
    if (!w) {
      w = {
        computer,
        evidence: 0,
        outgoing: 0,
        score: 0,
        byType: { user: 0, machine: 0, other: 0 },
        detail: { destinations: new Set(), accounts: new Set(), orientations: {}, outcomes: {}, logonTypes: {} },
      }
      open.set(computer, w)
    }
    return w
  }

  const note = (w: Window, r: AuthRecord, sourceUser: string, destinationUser: string, destination: string | null) => {
    w.evidence++
    if (!w.detail) return
    if (w.evidence > rule.maxEvents) {
      w.detail = null
      return
    }
    w.detail.accounts.add(sourceUser).add(destinationUser)
    if (destination !== null) w.detail.destinations.add(destination)
    count(w.detail.orientations, r.orientation)
    count(w.detail.outcomes, r.result)
    count(w.detail.logonTypes, r.logonType)
  }

  const pickControl = (evaluation: Candidate): Control | null => {
    const own = computerIds.get(evaluation.computer)
    let best = -1
    let bestOther = -1
    let ownHours = 0
    const distance = (i: number) => Math.abs(quiet.evidence.at(i) - evaluation.evidence)
    const name = (i: number) => computerNames[quiet.computer.at(i)]
    // Windows were stored hour by hour, so an earlier index is an earlier
    // hour: only a strictly closer size replaces the best so far, except
    // across computers in one hour, where the name decides.
    for (let i = 0; i < quiet.length; i++) {
      if (quiet.computer.at(i) === own) {
        ownHours++
        if (best < 0 || distance(i) < distance(best)) best = i
      } else if (
        bestOther < 0 ||
        distance(i) < distance(bestOther) ||
        (distance(i) === distance(bestOther) && quiet.hour.at(i) === quiet.hour.at(bestOther) && name(i) < name(bestOther))
      ) {
        bestOther = i
      }
    }
    const chosen = best >= 0 ? best : bestOther
    if (chosen < 0) return null
    return {
      computer: name(chosen),
      ...place(quiet.hour.at(chosen)),
      evidence: quiet.evidence.at(chosen),
      score: 0,
      sizeDifference: quiet.evidence.at(chosen) - evaluation.evidence,
      sameComputer: best >= 0,
      scoreZeroHoursOfEvaluationComputer: ownHours,
    }
  }

  return {
    get pairs() {
      return pairs
    },

    add(r: AuthRecord) {
      const { sourceUser, destinationUser, sourceComputer: source, destinationComputer: destination } = r
      if (sourceUser === null || destinationUser === null || source === null || destination === null) {
        throw new Error(`line ${r.line}: a user or computer is missing, so the record forms no pair`)
      }
      if (r.time < lastTime) throw new Error(`line ${r.line}: time ${r.time} is earlier than ${lastTime}`)
      lastTime = r.time
      records++
      const h = hourOf(r.time)
      if (h !== hour) {
        closeHour()
        if (hour < rule.firstHour && h >= rule.firstHour) pairsBeforeFirstHour = pairs
        hour = h
      }

      let accounts = seen.get(destination)
      if (!accounts) seen.set(destination, (accounts = new Set()))
      const bySource = firstSeen(accounts, sourceUser)
      const byDestination = destinationUser !== sourceUser && firstSeen(accounts, destinationUser)
      if (h < rule.firstHour) return

      const from = windowOf(source)
      from.outgoing++
      if (bySource) {
        from.score++
        from.byType[accountType(sourceUser)]++
      }
      if (byDestination) {
        from.score++
        from.byType[accountType(destinationUser)]++
      }
      note(from, r, sourceUser, destinationUser, destination)
      if (destination !== source) note(windowOf(destination), r, sourceUser, destinationUser, null)
    },

    finish(): ScanResult {
      closeHour()
      if (hour < rule.firstHour) pairsBeforeFirstHour = pairs
      const evaluation = top[0] ?? null
      const control = evaluation ? pickControl(evaluation) : null
      const warnings: string[] = []
      if (top.length < rule.top) warnings.push(`only ${top.length} eligible windows; ${rule.top} were asked for`)
      if (evaluation) {
        const tied = scoreDistribution[evaluation.score]
        if (tied > 1) warnings.push(`${tied} eligible windows share the top score ${evaluation.score}; rank 1 was decided by the tie-breaks`)
        if (!control) warnings.push('no score-0 window exists, so there is no control')
        else {
          if (!control.sameComputer) warnings.push(`${evaluation.computer} has no score-0 hour; the control is another computer`)
          if (control.evidence < rule.minEvents || control.evidence > rule.maxEvents) {
            warnings.push(`the control has ${control.evidence} records, outside ${rule.minEvents} to ${rule.maxEvents}`)
          }
        }
      }
      return {
        rule,
        records,
        hours: hour + 1,
        pairs,
        pairsBeforeFirstHour,
        windows,
        scoreDistribution,
        top,
        evaluation,
        control,
        warnings,
      }
    },
  }
}
