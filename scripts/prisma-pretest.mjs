#!/usr/bin/env node
/**
 * Pre-test setup: ensures the Prisma client is generated.
 *
 * Why this exists: `prisma.config.ts` requires `DATABASE_URL` at config-load
 * time, even for `prisma generate` (which doesn't need a real DB). To keep
 * `npm test` working on a fresh checkout without forcing the user to set up
 * an `.env` first, we provide a fallback URL before delegating to Prisma.
 *
 * - If `.env` exists, load it normally and pass DATABASE_URL through.
 * - If only `.env.example` exists (typical fresh-clone state), copy it to
 *   `.env` so the rest of the dev workflow can also read it, then generate.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, copyFileSync } from 'node:fs'
import { config as loadDotenv } from 'dotenv'

const envFile = '.env'
const exampleFile = '.env.example'

if (!existsSync(envFile) && existsSync(exampleFile)) {
  copyFileSync(exampleFile, envFile)
  console.log('[prisma-pretest] Copied .env.example → .env (placeholder DATABASE_URL).')
}

loadDotenv({ path: envFile })

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://placeholder:placeholder@localhost:5432/placeholder'
  console.log('[prisma-pretest] No DATABASE_URL found, using placeholder for generate.')
}

const result = spawnSync('npx', ['prisma', 'generate'], {
  stdio: 'inherit',
  env: process.env,
})

process.exit(result.status ?? 1)
