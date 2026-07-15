/**
 * LLM-judge runner (F1.9, T12.D4) — NON-GATING: exit code is always 0; the
 * verdicts are trend data, never a merge gate.
 *
 *   npx tsx scripts/sims/run-judge.ts
 *
 * For each JUDGE_RUBRICS entry, find the newest artifacts/sims export whose
 * scenario transcript exists, render the dialogue, ask the judge model the
 * rubric question, and append strict PASS/FAIL verdicts to
 * artifacts/judge/verdicts-<date>.json. Requires ANTHROPIC_API_KEY (model
 * from ZENO_JUDGE_MODEL, default claude-haiku-4-5-20251001); without a key
 * it reports and exits 0 — trend tooling must never block.
 */
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { JUDGE_RUBRICS } from '@/lib/testing/judge/rubrics'
import type { ConversationExport } from '@/lib/debug/conversation-export'

const ROOT = process.cwd()
const SIMS_DIR = path.join(ROOT, 'artifacts/sims')
const JUDGE_DIR = path.join(ROOT, 'artifacts/judge')

function newestExport(): { file: string; bundle: ConversationExport } | null {
  if (!fs.existsSync(SIMS_DIR)) return null
  const files = fs.readdirSync(SIMS_DIR).filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(SIMS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  if (files.length === 0) return null
  const file = path.join(SIMS_DIR, files[0].f)
  return { file, bundle: JSON.parse(fs.readFileSync(file, 'utf8')) as ConversationExport }
}

function renderTranscript(e: ConversationExport): string {
  return e.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role === 'user' ? 'CUSTOMER' : 'AGENT'}: ${m.content}`)
    .join('\n')
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('run-judge: ANTHROPIC_API_KEY not set — skipping (non-gating trend tooling).')
    process.exit(0)
  }
  const latest = newestExport()
  if (!latest) {
    console.log('run-judge: no exports in artifacts/sims — run sims:spec first. Skipping.')
    process.exit(0)
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()
  const model = process.env.ZENO_JUDGE_MODEL ?? 'claude-haiku-4-5-20251001'
  const transcript = renderTranscript(latest.bundle)

  const verdicts: { rubricId: string; specId: string; verdict: string; justification: string }[] = []
  for (const rubric of JUDGE_RUBRICS) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `You are grading an insurance-agent conversation transcript against ONE rubric.\n\nRubric question: ${rubric.question}\nPass criteria: ${rubric.passCriteria}\n\nTranscript:\n${transcript.slice(0, 30_000)}\n\nAnswer STRICTLY as JSON: {"verdict": "PASS"|"FAIL"|"NOT_APPLICABLE", "justification": "<one sentence>"}. NOT_APPLICABLE when the transcript never exercises the rubric's situation.`,
        }],
      })
      const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
      const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { verdict: string; justification: string }
      verdicts.push({ rubricId: rubric.id, specId: rubric.specId, ...parsed })
      console.log(`  ${rubric.id}: ${parsed.verdict} — ${parsed.justification}`)
    } catch (e) {
      verdicts.push({ rubricId: rubric.id, specId: rubric.specId, verdict: 'ERROR', justification: (e as Error).message })
      console.log(`  ${rubric.id}: ERROR — ${(e as Error).message}`)
    }
  }
  fs.mkdirSync(JUDGE_DIR, { recursive: true })
  const date = new Date().toISOString().slice(0, 10)
  fs.writeFileSync(
    path.join(JUDGE_DIR, `verdicts-${date}.json`),
    JSON.stringify({ export: path.basename(latest.file), model, verdicts }, null, 2),
  )
  console.log(`run-judge: ${verdicts.length} verdicts -> artifacts/judge/verdicts-${date}.json (non-gating)`)
  process.exit(0)
}

main().catch((e) => { console.error('run-judge error (non-gating):', e); process.exit(0) })
