#!/usr/bin/env node
// Refresh the new screenshots that the UX review report references.
// Saves into .ux-review/shots/ so they survive session repairs.

import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')
const SHOTS_DIR = join(PROJECT_ROOT, '.ux-review', 'shots')
mkdirSync(SHOTS_DIR, { recursive: true })

const BASE = 'http://localhost:3000'
const CHROMIUM = '/Users/jan/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

// Each shot: name → { path, viewport, waitFor? }
const SHOTS = [
  // Fix 1: households reload works
  { name: 'households-final', path: '/households', viewport: 'mobile' },

  // Fix 2: dashboard with real data
  { name: 'dashboard-real', path: '/', viewport: 'desktop' },

  // Fix 3: mobile cards
  { name: 'expenses-mobile-fixed', path: '/transactions/expenses', viewport: 'mobile' },
  { name: 'income-mobile-fixed', path: '/transactions/income', viewport: 'mobile' },
  { name: 'members-mobile-fixed', path: '/households/members', viewport: 'mobile' },
  // Fix 3: desktop stays table
  { name: 'expenses-desktop-fixed', path: '/transactions/expenses', viewport: 'desktop' },
  { name: 'income-desktop-fixed', path: '/transactions/income', viewport: 'desktop' },
  { name: 'members-desktop-fixed', path: '/households/members', viewport: 'desktop' },

  // Not-reproducible bug
  { name: 'recurring-current', path: '/budgeting/recurring', viewport: 'desktop' },
]

const VP = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
}

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})

let totalConsoleErrors = 0
const allErrors = []

async function takeShot(page, shot) {
  const vp = VP[shot.viewport]
  await page.setViewportSize(vp)

  const url = BASE + shot.path
  console.log(`[shot] ${shot.name.padEnd(28)} ${url}  (${vp.width}x${vp.height})`)

  const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
  if (!resp || !resp.ok()) {
    console.log(`  ! status: ${resp ? resp.status() : 'no response'}`)
  }

  // Let any animations / skeletons settle
  await page.waitForTimeout(900)

  const out = join(SHOTS_DIR, `${shot.name}.png`)
  await page.screenshot({ path: out, fullPage: false })
  return out
}

const ctx = await browser.newContext({ deviceScaleFactor: 1 })
const page = await ctx.newPage()

const errorsThisShot = []
page.on('console', msg => {
  if (msg.type() === 'error') {
    errorsThisShot.push(msg.text())
  }
})
page.on('pageerror', err => {
  errorsThisShot.push('PAGEERROR: ' + err.message)
})

// Auth: log in as Jan by hitting the login API directly and setting the session cookie.
// This is faster and more reliable than clicking through the UI.
console.log('[auth] logging in as Jan via API')
const loginResp = await page.request.post(BASE + '/api/auth/login', {
  data: { userId: '4a21bf3e-d631-42b7-a66a-ee80d588e147' }, // Jan's id from /api/auth/mock-users
})
console.log(`[auth] login response: ${loginResp.status()}`)
if (loginResp.status() >= 400) {
  const body = await loginResp.text()
  console.log('[auth] body:', body)
  process.exit(1)
}

// Verify auth worked
const sessionCheck = await page.request.get(BASE + '/api/auth/session')
console.log(`[auth] session check: ${sessionCheck.status()}`)
const sessionBody = await sessionCheck.json().catch(() => null)
console.log(`[auth] user: ${sessionBody?.user?.displayName ?? 'unknown'}`)

for (const shot of SHOTS) {
  errorsThisShot.length = 0
  try {
    const out = await takeShot(page, shot)
    const errCount = errorsThisShot.length
    totalConsoleErrors += errCount
    if (errCount) {
      allErrors.push({ shot: shot.name, errors: [...errorsThisShot] })
      console.log(`  ! ${errCount} console error(s)`)
    }
    console.log(`  -> ${out}`)
  } catch (e) {
    console.log(`[shot] FAILED ${shot.name}: ${e.message}`)
  }
}

await browser.close()

console.log(`\nDONE. ${SHOTS.length} shots, ${totalConsoleErrors} total console errors.`)
if (allErrors.length) {
  console.log('Errors by shot:')
  for (const e of allErrors) {
    console.log(`  ${e.shot}: ${e.errors[0].substring(0, 120)}`)
  }
}
