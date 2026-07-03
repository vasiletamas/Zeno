/**
 * diagnose-conversation CLI (F4.4, T14.D6 layer 1) — deterministic triage
 * over ConversationExport v2. All decisions live in lib/diagnostics; this
 * shell only loads, runs and prints.
 *
 * Usage:
 *   npx tsx scripts/diagnose-conversation.ts <conversationId> [--json]
 *   npx tsx scripts/diagnose-conversation.ts --all [--since=7] [--json]
 *   npx tsx scripts/diagnose-conversation.ts --dir=artifacts/sims [--json]
 *
 * Single/batch load via loadConversationExport (real DB, recompute-drift
 * enabled at the live engine version); --dir reads exported JSON files from
 * disk with recompute enabled too (fixtures carry real snapshots).
 * Exit 1 iff any finding has severity 'error' (the CI gate).
 */
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { loadConversationExport } from '@/lib/debug/load-export'
import { runDiagnostics, type Finding } from '@/lib/diagnostics'
import { formatFindingsTable, summarize } from '@/lib/diagnostics/report'
import { engineVersion } from '@/lib/engines/derive-and-expose'
import type { ConversationExport } from '@/lib/debug/conversation-export'

interface Args { id: string | null; all: boolean; since: number; dir: string | null; json: boolean }

function parseArgs(argv: string[]): Args {
  const out: Args = { id: null, all: false, since: 7, dir: null, json: false }
  for (const a of argv) {
    if (a === '--json') out.json = true
    else if (a === '--all') out.all = true
    else if (a.startsWith('--since=')) out.since = parseInt(a.slice(8), 10)
    else if (a.startsWith('--dir=')) out.dir = a.slice(6)
    else if (!a.startsWith('--')) out.id = a
  }
  return out
}

function diagnose(e: ConversationExport): Finding[] {
  return runDiagnostics(e, undefined, { currentEngineVersion: engineVersion })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const results: { conversationId: string; findings: Finding[] }[] = []

  if (args.dir) {
    // CI mode — exported JSON files from disk, no DB
    const dir = path.resolve(process.cwd(), args.dir)
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    for (const f of files) {
      const bundle = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as ConversationExport
      results.push({ conversationId: `${f} (${bundle.conversationId})`, findings: diagnose(bundle) })
    }
  } else if (args.all) {
    const since = new Date(Date.now() - args.since * 86400e3)
    const convs = await prisma.conversation.findMany({
      where: { messages: { some: { createdAt: { gte: since } } } },
      select: { id: true },
      orderBy: { startedAt: 'asc' },
    })
    for (const c of convs) {
      const bundle = await loadConversationExport(c.id)
      if (bundle) results.push({ conversationId: c.id, findings: diagnose(bundle) })
    }
  } else if (args.id) {
    const bundle = await loadConversationExport(args.id)
    if (!bundle) {
      console.error(`conversation ${args.id} not found`)
      process.exit(1)
    }
    results.push({ conversationId: args.id, findings: diagnose(bundle) })
  } else {
    console.error('usage: diagnose-conversation <conversationId> | --all [--since=N] | --dir=<path> [--json]')
    process.exit(1)
  }

  const all = results.flatMap((r) => r.findings)
  if (args.json) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    for (const r of results) console.log(formatFindingsTable(r.conversationId, r.findings))
    const s = summarize(all)
    console.log(`\n==== ${results.length} conversation(s): ${s.error} error / ${s.warn} warn / ${s.info} info ====`)
  }
  process.exit(all.some((f) => f.severity === 'error') ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
