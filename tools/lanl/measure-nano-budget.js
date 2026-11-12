// Measures how many LANL evidence rows fit Gemini Nano's context window, for
// freezing the candidate scan's evidence-size limit. Synthetic rows only:
// built by the real converter (tools/lanl/case.ts) from invented records.
//
// Run: `npm run dev`, open http://localhost:5173 in Chrome where Gemini Nano
// is "available", open DevTools > Console, paste this whole file, press Enter
// once, and wait for "Done." Nothing is sent anywhere.
//
// The system prompt is GS-03's (as of 2026-11-11) plus the LANL time note: a
// stand-in, since the LANL prompt is not written yet. The limit keeps 10%
// margin for that difference.
//
// Prompt API names: web pages have measureContextUsage, contextUsage and
// contextWindow. The older measureInputUsage, inputUsage and inputQuota are
// deprecated and exist only in extensions, so they are a fallback here.

(async () => {
  // DevTools' copy() exists only while the console evaluates the pasted text,
  // so it is taken now, before the first await.
  const consoleCopy = typeof copy === 'function' ? copy : null
  if (globalThis.nanoBudgetRunning) {
    console.warn('A measurement is already running in this tab. Wait for its "Done." line.')
    return
  }
  globalThis.nanoBudgetRunning = true

  const describe = (e) => `${e?.name ?? 'Error'}: ${e?.message ?? String(e)}`
  const out = {
    chrome: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? null,
    api: null, contextWindow: null, systemTokens: null, outputReserve: null,
    rows: [], runs: [], errors: [],
  }

  try {
    const { toEvidence, AUTH_VOCABULARY, LANL_TIME_NOTE } = await import('/tools/lanl/case.ts')
    const { lanlProposalSchema, LANL_FINDING_TYPES, MAX_FINDINGS, MAX_ACTIONS, MAX_EVENTS_PER_FINDING } =
      await import('/src/lib/schema.ts')
    const { parseProposal } = await import('/src/lib/verify.ts')

    const SYSTEM_PROMPT =
      'You assist a security analyst. You are given a list of log events from one ' +
      'organisation, each with an ID. Use only the events given. First list your ' +
      `findings, at most ${MAX_FINDINGS}, about the events that bear on whether an ` +
      'account was misused; leave out routine activity. Every finding must cite the ' +
      'IDs of the events that support it, and must quote times exactly as the events ' +
      'give them. Give each finding the type that matches what its cited events show, ' +
      'or "other" if no type fits, and cite only the events that directly show it: a ' +
      'sign-out is not a sign-in. Then explain in at most three sentences, then ' +
      'classify. Credential Compromise: someone other than the owner used an account. ' +
      'Insider Threat: a trusted person misused access they legitimately hold. ' +
      'Phishing: a deceptive message was used to gain access. Ransomware: data was ' +
      'encrypted for extortion. Data Exfiltration: data was copied out of the ' +
      'organisation. Do not say that data was accessed or taken, or that a person is ' +
      'at fault, unless an event says so. If the events are not enough to decide, ' +
      `choose Undetermined. Recommend at most ${MAX_ACTIONS} actions. You make a ` +
      'proposal. The analyst decides.' + ' ' + LANL_TIME_NOTE

    // Invented records in LANL's shapes, with realistic identifier lengths and
    // the inventory's mix of event types (LogOn 45%, LogOff 41%, TGS 9%, TGT 4%).
    const pick = (i, list) => list[i % list.length]
    const kinds = [
      ['LogOn', 'Network', 'Kerberos'], ['LogOff', 'Network', '?'], ['LogOn', 'Network', 'NTLM'],
      ['LogOff', '?', '?'], ['LogOn', 'Service', 'Negotiate'], ['LogOff', 'Network', '?'],
      ['TGS', '?', 'Kerberos'], ['LogOn', 'Network', 'Kerberos'], ['LogOff', 'Network', '?'],
      ['LogOn', 'Interactive', 'Kerberos'], ['TGT', '?', 'Kerberos'],
    ]
    const record = (i) => {
      const [orientation, logonType, authType] = pick(i, kinds)
      const user = i % 4 === 0 ? `C${17000 + (i * 37) % 900}$@DOM1` : `U${100 + (i * 53) % 9900}@DOM1`
      const time = 691201 + i * 17
      return {
        file: 'synthetic', line: i + 1, raw: '', time,
        sourceUser: user, destinationUser: user,
        sourceComputer: `C${17000 + (i * 7) % 900}`, destinationComputer: `C${100 + (i * 131) % 19000}`,
        authType: authType === '?' ? null : authType, logonType: logonType === '?' ? null : logonType,
        orientation, result: i % 40 === 39 ? 'Fail' : 'Success',
      }
    }
    const rowsFor = (n) => {
      const c = toEvidence(Array.from({ length: n }, (_, i) => record(i)), AUTH_VOCABULARY)
      if (!c.ok) throw new Error(c.errors.join('; '))
      return c.events.map(({ evidence: e }) =>
        [e.id, `${e.date} ${e.time}`, e.source, e.actor, e.action, e.target, e.outcome, e.detail].join(' | '))
    }
    const promptFor = (n) =>
      'Events (ID | date time | source | actor | action | target | outcome | detail):\n' +
      rowsFor(n).join('\n') +
      '\n\nList findings that cite event IDs, then explain, then propose a classification.'

    // The largest answer the schema allows, as a stand-in for output size.
    const longest = JSON.stringify({
      findings: Array.from({ length: MAX_FINDINGS }, (_, i) => ({
        type: 'logon',
        claim: `U${1000 + i}@DOM1 logged on to C${20000 + i} from C17693 at Day 9 · elapsed 02:24:${10 + i}, a first logon to that computer.`,
        event_ids: Array.from({ length: MAX_EVENTS_PER_FINDING }, (_, j) => `E${10 + i * 4 + j}`),
      })),
      explanation: 'One account logged on to several computers it had not used before within one dataset hour. ' +
        'The logons were network logons from a single source computer. The evidence does not show who used the account.',
      classification: 'Credential Compromise',
      confidence: 'Medium',
      recommended_actions: Array.from({ length: MAX_ACTIONS }, (_, i) => `Review the logons from C17693 to the ${i + 1}th destination computer.`),
    })

    const createOptions = {
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
    }
    const isCount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
    const measureName = (s) =>
      typeof s.measureContextUsage === 'function' ? 'measureContextUsage'
        : typeof s.measureInputUsage === 'function' ? 'measureInputUsage' : null
    const usageOf = (s) => s.contextUsage ?? s.inputUsage
    // A measurement is a token count or an error, never a number that stands
    // for an error.
    const measure = async (s, text, options) => {
      const name = measureName(s)
      try {
        const tokens = await s[name](text, options)
        return isCount(tokens) ? { tokens, error: null } : { tokens: null, error: `${name} returned ${String(tokens)}` }
      } catch (e) {
        return { tokens: null, error: describe(e) }
      }
    }

    const session = await LanguageModel.create(createOptions)
    out.api = {
      measure: measureName(session),
      members: Object.getOwnPropertyNames(Object.getPrototypeOf(session)).sort(),
    }
    if (!out.api.measure) throw new Error(`this Chrome has no measureContextUsage or measureInputUsage; session members: ${out.api.members.join(', ')}`)
    const contextWindow = session.contextWindow ?? session.inputQuota
    const system = usageOf(session)
    if (!isCount(contextWindow) || contextWindow === 0) throw new Error(`context window is ${String(contextWindow)}, not a token count`)
    if (!isCount(system) || system === 0) throw new Error(`system prompt usage is ${String(system)}, not a token count`)
    out.contextWindow = contextWindow
    out.systemTokens = system

    const reserve = await measure(session, longest)
    out.outputReserve = reserve.tokens
    if (reserve.error) out.errors.push(`output reserve: ${reserve.error}`)

    for (let n = 10; n <= 100; n += 5) {
      const prompt = promptFor(n)
      const evidence = await measure(session, prompt)
      const withSchema = await measure(session, prompt, { responseConstraint: lanlProposalSchema })
      const errors = [
        evidence.error && `evidence: ${evidence.error}`,
        withSchema.error && `with schema: ${withSchema.error}`,
        reserve.error && `output reserve: ${reserve.error}`,
      ].filter(Boolean)
      const measured = errors.length === 0
      const total = measured ? system + withSchema.tokens + reserve.tokens : null
      out.rows.push({
        events: n,
        evidenceTokens: evidence.tokens,
        withSchemaTokens: withSchema.tokens,
        schemaOverhead: evidence.error || withSchema.error ? null : withSchema.tokens - evidence.tokens,
        systemTokens: system,
        outputReserve: reserve.tokens,
        total,
        contextWindow,
        fitsWith10pcMargin: measured ? total <= 0.9 * contextWindow : null, // null: not measured
        error: errors.join('; ') || null,
      })
    }
    session.destroy()
    console.table(out.rows)

    // Real inference, on a fresh session each time: at 20 events and at the
    // largest tested size that fits with the margin. Records whether Nano
    // finishes, how long it takes, what the context actually held afterwards,
    // and whether the parser accepts the answer.
    const largest = out.rows.filter((r) => r.fitsWith10pcMargin === true).at(-1)?.events
    if (largest === undefined) {
      out.errors.push('no size was measured as fitting, so only the 20-event run was made')
      console.warn('No size was measured as fitting. Only the 20-event run will be made.')
    }
    for (const n of [...new Set([20, largest].filter(Boolean))]) {
      console.log(`Running Nano on ${n} synthetic events… (can take a few minutes)`)
      const s = await LanguageModel.create(createOptions)
      let overflowed = false
      for (const type of ['contextoverflow', 'quotaoverflow']) s.addEventListener(type, () => { overflowed = true })
      const row = out.rows.find((r) => r.events === n)
      const run = {
        events: n, completed: false, seconds: null,
        predictedInputTokens: row?.withSchemaTokens == null ? null : system + row.withSchemaTokens,
      }
      const started = performance.now()
      try {
        const text = await s.prompt(promptFor(n), { responseConstraint: lanlProposalSchema })
        run.seconds = +((performance.now() - started) / 1000).toFixed(1)
        run.completed = true
        const used = usageOf(s)
        const output = await measure(s, text)
        const parse = parseProposal(text, LANL_FINDING_TYPES)
        Object.assign(run, {
          contextUsedAfter: isCount(used) ? used : null, // system + input + answer, as Chrome counts it
          outputTokens: output.tokens,
          outputTokensError: output.error,
          outputChars: text.length,
          schemaValid: parse.ok,
          findings: parse.ok ? parse.proposal.findings.length : null,
          parseErrors: parse.ok ? null : parse.errors.slice(0, 3).join('; '),
        })
      } catch (e) {
        run.seconds = +((performance.now() - started) / 1000).toFixed(1)
        run.error = describe(e)
      }
      run.contextOverflowed = overflowed
      s.destroy()
      out.runs.push(run)
    }
    console.table(out.runs)
  } catch (e) {
    out.errors.push(describe(e))
    console.error(`Measurement stopped: ${describe(e)}`)
  } finally {
    globalThis.nanoBudgetRunning = false
  }

  const result = JSON.stringify(out)
  globalThis.nanoBudgetResult = result
  console.log(result)
  let copied = false
  try {
    if (consoleCopy) { consoleCopy(result); copied = true }
  } catch { /* reported below */ }
  console.log(
    (out.errors.length > 0 ? `Done, with ${out.errors.length} error(s): see "errors" in the result. ` : 'Done. ') +
    (copied ? 'The result should be on your clipboard. If it is not, type' : 'To put the result on your clipboard, type') +
    ' copy(nanoBudgetResult) and press Enter.',
  )
})()
