// Checks a production build for App Check debug tokens before it can be
// deployed. A debug token lets anyone who has it pass App Check, so it must
// never reach a built file. The scan reports where and which rule matched,
// and never prints a secret's value.
//
// What the Firebase SDK itself ships is allowed: it reads the global
// FIREBASE_APPCHECK_DEBUG_TOKEN with comparisons such as
// `typeof x.FIREBASE_APPCHECK_DEBUG_TOKEN != "string"`. Assigning it is not.

export interface Finding {
  file: string
  rule: string
}

// The SDK creates debug tokens as random UUIDs.
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i

const RULES: { rule: string; test: (text: string) => boolean }[] = [
  { rule: 'a UUID-shaped string (the form of an App Check debug token)', test: (t) => UUID.test(t) },
  {
    rule: 'FIREBASE_APPCHECK_DEBUG_TOKEN is set, not only read',
    test: (t) => /FIREBASE_APPCHECK_DEBUG_TOKEN\s*(:|=(?!=))/.test(t),
  },
  {
    rule: 'the variable name VITE_APPCHECK_DEBUG_TOKEN (the environment was inlined)',
    test: (t) => t.includes('VITE_APPCHECK_DEBUG_TOKEN'),
  },
]

// `secrets`: values that must not appear anywhere, such as the debug token in
// .env.development.local. They are compared, never printed.
export function scanFile(file: string, text: string, secrets: readonly string[] = []): Finding[] {
  const findings = RULES.filter((r) => r.test(text)).map((r) => ({ file, rule: r.rule }))
  if (secrets.some((s) => s.length >= 8 && text.includes(s))) {
    findings.push({ file, rule: 'a value from a local secrets file' })
  }
  return findings
}

// A built file that should never exist.
export function scanName(file: string): Finding[] {
  const base = file.split('/').pop() ?? file
  return base.startsWith('.env') ? [{ file, rule: 'an environment file was copied into the build' }] : []
}

// Reads `NAME=value` lines; values in quotes are unquoted. Comments and blank
// lines are skipped.
export function envValue(envText: string, name: string): string | undefined {
  for (const line of envText.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && m[1] === name) return m[2].replace(/^(['"])(.*)\1$/, '$2') || undefined
  }
  return undefined
}
