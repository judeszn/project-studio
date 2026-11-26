import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { envValue, scanFile, scanName, type Finding } from './scan'

// npm run scan:build [-- <directory>]   (default: dist)
// Fails, and lists file and rule, if the build carries an App Check debug
// token or anything that looks like one. Runs before every Firebase deploy
// (firebase.json predeploy) and in CI.

const root = resolve(process.cwd())
const target = resolve(root, process.argv.slice(2).find((a) => a !== '--') ?? 'dist')

if (!existsSync(target)) {
  console.error(`No build at ${relative(root, target) || '.'}: run npm run build first.`)
  process.exit(1)
}

const secrets = ['.env.development.local', '.env.local', '.env.production.local']
  .map((f) => join(root, f))
  .filter(existsSync)
  .map((f) => envValue(readFileSync(f, 'utf8'), 'VITE_APPCHECK_DEBUG_TOKEN'))
  .filter((v): v is string => Boolean(v))

const files: string[] = []
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else files.push(path)
  }
}
walk(target)

const TEXT = /\.(html|js|mjs|css|json|map|svg|txt|webmanifest)$/
const findings: Finding[] = files.flatMap((path) => {
  const file = relative(root, path)
  return [...scanName(file), ...(TEXT.test(path) ? scanFile(file, readFileSync(path, 'utf8'), secrets) : [])]
})

if (findings.length > 0) {
  console.error(`Build scan failed: ${findings.length} finding(s). Do not deploy this build.`)
  for (const f of findings) console.error(`  ${f.file}: ${f.rule}`)
  process.exit(1)
}
console.log(
  `Build scan passed: ${files.length} files in ${relative(root, target)}, no debug token` +
    ` (${secrets.length} local secret value(s) compared, not printed).`,
)
