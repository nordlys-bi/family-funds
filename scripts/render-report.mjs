#!/usr/bin/env node
// Render the bottom of the report (Empfehlung section) for visual check
import { chromium } from 'playwright-core'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPORT = join(__dirname, '..', '.ux-review', 'index.html')
const CHROMIUM = '/Users/jan/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 })
await page.goto('file://' + REPORT, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

// Scroll to bottom and screenshot
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await page.waitForTimeout(300)
await page.screenshot({
  path: join(__dirname, '..', '.ux-review', 'report-preview-bottom.png'),
  fullPage: false,
})

// Also scroll to the "Was gefixt wurde" section to verify the new screenshots
await page.evaluate(() => {
  const headings = document.querySelectorAll('h2')
  for (const h of headings) {
    if (h.textContent.includes('Was gefixt')) {
      h.scrollIntoView({ block: 'start' })
      return
    }
  }
})
await page.waitForTimeout(300)
await page.screenshot({
  path: join(__dirname, '..', '.ux-review', 'report-preview-fixes.png'),
  fullPage: false,
})

await browser.close()
console.log('Bottom + fixes preview saved.')
