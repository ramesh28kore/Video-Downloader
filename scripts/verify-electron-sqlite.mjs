// Phase-0 spike: prove that Electron 44's main process exposes `node:sqlite`
// (DatabaseSync) so the DB layer can be built on the builtin instead of
// better-sqlite3. Runs a throwaway Electron process against a temp user-data
// dir and prints PASS/FAIL.
//
// Usage: node scripts/verify-electron-sqlite.mjs
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let electronPath
try {
  electronPath = require('electron')
} catch {
  console.error('electron module not installed yet — run `npm install` first')
  process.exit(2)
}

const userData = mkdtempSync(join(tmpdir(), 'tbfs-spike-'))
const mainJs = join(userData, 'main.cjs')
writeFileSync(
  mainJs,
  `'use strict'
const { app } = require('electron')
app.disableHardwareAcceleration()
app.setPath('userData', ${JSON.stringify(userData)})
app.whenReady().then(() => {
  let report
  try {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE t (a INTEGER, b TEXT)')
    const ins = db.prepare('INSERT INTO t VALUES (?, ?)')
    ins.run(1, 'ok'); ins.run(2, 'wal')
    const rows = db.prepare('SELECT COUNT(*) AS n, SUM(a) AS s FROM t').all()
    db.exec('PRAGMA journal_mode = WAL')
    report = { ok: true, rows, electron: process.versions.electron, node: process.versions.node }
  } catch (err) {
    report = { ok: false, error: String(err && err.stack || err) }
  }
  process.stdout.write('SPIKE_RESULT ' + JSON.stringify(report) + '\\n')
  app.quit()
})
`
)

const child = spawn(String(electronPath), [mainJs], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  stdio: ['ignore', 'pipe', 'pipe']
})
let out = ''
child.stdout.on('data', (d) => {
  out += d.toString()
  process.stdout.write(d)
})
child.stderr.on('data', (d) => process.stderr.write(d))
child.on('exit', (code) => {
  rmSync(userData, { recursive: true, force: true })
  const pass = out.includes('"ok":true')
  console.log(pass ? '\n[PASS] node:sqlite works inside Electron main process.' : '\n[FAIL] node:sqlite unavailable — fall back to better-sqlite3.')
  process.exit(pass ? 0 : (code ?? 1))
})
