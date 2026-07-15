/**
 * Prompt-cost report over persisted TurnDebug rows (A2, plan 2026-07-06).
 *
 * Sweeps the most recent N conversations that have TurnDebug rows and prints
 * per-phase averages: prompt tokens/turn, call-level cache-hit rate,
 * stable/dynamic prompt char split, tool-definition size, identity-section
 * share. The verbatim output goes into the baseline note
 * (docs/superpowers/notes/) before any cost-affecting change lands, and the
 * report is re-run after workstreams D and E to prove their effect.
 *
 * Usage:
 *   npx tsx scripts/measure-prompt-cost.ts                # last 10 conversations
 *   npx tsx scripts/measure-prompt-cost.ts --conversations 25
 *   npx tsx scripts/measure-prompt-cost.ts --since 7      # started in the last 7 days
 *
 * NOTE: cache-hit telemetry only exists on turns recorded after A1 shipped;
 * older rows count into "turns without usage".
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { buildPromptCostReport, formatPromptCostReport, type TurnCostRow } from '@/lib/analytics/prompt-cost'

interface Options {
  conversations: number
  sinceDays: number | null
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { conversations: 10, sinceDays: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--conversations') opts.conversations = Number(argv[++i] ?? 10)
    if (argv[i] === '--since') opts.sinceDays = Number(argv[++i] ?? 1)
  }
  return opts
}

export async function measurePromptCost(opts: Options): Promise<string> {
  const conversationFilter = opts.sinceDays !== null
    ? { createdAt: { gte: new Date(Date.now() - opts.sinceDays * 86_400_000) } }
    : {}

  // Latest conversations that actually have debug rows to read.
  const conversations = await prisma.conversation.findMany({
    where: { ...conversationFilter, turnDebugs: { some: {} } },
    orderBy: { createdAt: 'desc' },
    take: opts.conversations,
    select: { id: true },
  })
  if (conversations.length === 0) return 'No conversations with TurnDebug rows found.'

  const rows = await prisma.turnDebug.findMany({
    where: { conversationId: { in: conversations.map((c) => c.id) } },
    orderBy: [{ conversationId: 'asc' }, { messageIndex: 'asc' }],
    select: { conversationId: true, messageIndex: true, payload: true },
  })

  const report = buildPromptCostReport(rows as unknown as TurnCostRow[])
  return formatPromptCostReport(report)
}

// CLI entry — guarded so a test import does not hit the DB
if (process.argv[1]?.endsWith('measure-prompt-cost.ts')) {
  measurePromptCost(parseArgs(process.argv.slice(2)))
    .then((out) => {
      console.log(out)
      process.exit(0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
