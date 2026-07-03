import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

/**
 * Writer-closure meta-test (C1.8, T6 risk #1 made executable): the
 * append-only revision model only holds if NOTHING writes prisma.answer
 * outside the single-writer store. Matches any client variable (prisma /
 * db / tx / context.db) — the store's own Db seam included.
 */
const ALLOWED = [
  'lib/engines/answer-store.ts',          // the single writer
  'app/api/gdpr/delete-data/route.ts',    // GDPR erasure — owned by M3, audited there
]

describe('answer writer closure', () => {
  it('no Answer write call exists outside the answer store', () => {
    let out = ''
    try {
      out = execSync(
        String.raw`git grep -l -E "\.answer\.(create|update|upsert|delete|createMany|updateMany|deleteMany)" -- lib app`,
        { encoding: 'utf8', cwd: process.cwd() },
      )
    } catch (e) {
      // git grep exits 1 on zero matches — that is closure, not an error
      const err = e as { status?: number; stdout?: string }
      if (err.status !== 1) throw e
      out = err.stdout ?? ''
    }
    const files = out.trim().split('\n').filter(Boolean).map((p) => p.replace(/\\/g, '/'))
    const offenders = files.filter((f) => !ALLOWED.includes(f))
    expect(offenders).toEqual([])
  })

  it('the legacy visibility columns are gone from the schema (one dependency store, T6.D1)', () => {
    const live = readFileSync('prisma/schema.prisma', 'utf8')
    expect(live).not.toMatch(/parentQuestionId/)
    expect(live).not.toMatch(/showWhenValue/)
  })
})
