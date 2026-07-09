#!/usr/bin/env node
// Take verification screenshots after the 4 P2 fixes.
// All login as Jan, mobile + desktop, focused on the things that changed.

import { chromium } from 'playwright-core'
import { join, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SHOTS_DIR = join(__dirname, '..', '.ux-review', 'shots-after-fixes')
mkdirSync(SHOTS_DIR, { recursive: true })

const BASE = 'http://localhost:3000'
const CHROMIUM = '/Users/jan/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

const SHOTS = [
  // Fix 4 — Mobile-Header-Truncation
  { name: 'header-mobile-after', path: '/households', viewport: 'mobile' },
  // Fix 2 — Eyebrow versteckt auf Mobile
  { name: 'expenses-mobile-no-eyebrow', path: '/transactions/expenses', viewport: 'mobile' },
  { name: 'households-mobile-no-eyebrow', path: '/households', viewport: 'mobile' },
  { name: 'recurring-desktop-no-eyebrow', path: '/budgeting/recurring', viewport: 'desktop' },
  // Fix 1 — Sandbox-Badge in mock mode noch da
  { name: 'dashboard-with-sandbox-badge', path: '/', viewport: 'desktop' },
  // Fix 3 — Login-Sie→Du
  { name: 'login-after', path: '/login', viewport: 'mobile' },
  { name: 'login-after-desktop', path: '/login', viewport: 'desktop' },
]

const VP = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
}

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})

const consoleErrors = []

const ctx = await browser.newContext({ deviceScaleFactor: 1 })
const page = await ctx.newPage()

page.on('console', msg => {
  if (msg.type() === 'error') {
    consoleErrors.push(msg.text())
  }
})
page.on('pageerror', err => {
  consoleErrors.push('PAGEERROR: ' + err.message)
})

// Login as Jan
const loginResp = await page.request.post(BASE + '/api/auth/login', {
  data: { userId: '4a21bf3e-d631-42b7-a66a-ee80d588e147' },
})
console.log(`[auth] login: ${loginResp.status()}`)
if (loginResp.status() >= 400) {
  console.log('[auth] failed — need to check if logged-in shots still work')
}

// Login page needs a clean context (no session_user_id cookie), since
// pages/login.vue redirects to / when already logged in (see onMounted).
const anonCtx = await browser.newContext({ deviceScaleFactor: 1 })
const anonPage = await anonCtx.newPage()
anonPage.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
anonPage.on('pageerror', err => consoleErrors.push('PAGEERROR: ' + err.message))

for (const shot of SHOTS) {
  const vp = VP[shot.viewport]
  // Login-page screenshots need the anon context (no session cookie)
  const useAnon = shot.name.startsWith('login')
  const target = useAnon ? anonPage : page
  await target.setViewportSize(vp)
  const errBefore = consoleErrors.length
  // Hard reload: bypass cache to avoid HMR-cached versions of the component
  const resp = await target.goto(BASE + shot.path + '?_=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 })
  await target.waitForTimeout(1200)
  const out = join(SHOTS_DIR, `${shot.name}.png`)
  await target.screenshot({ path: out, fullPage: false })
  const errCount = consoleErrors.length - errBefore
  console.log(`[shot] ${shot.name.padEnd(34)} ${shot.path}  (${vp.width}x${vp.height})  status=${resp?.status()}  console-errs=${errCount}  ${useAnon ? '(anon)' : ''}`)
}

await browser.close()
console.log(`\nTotal console errors: ${consoleErrors.length}`)
if (consoleErrors.length) {
  console.log(consoleErrors.slice(0, 5).join('\n'))
}
