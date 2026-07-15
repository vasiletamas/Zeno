/**
 * Recompute-and-diff replay CLI (F2.3, T14.D2).
 *
 *   npx tsx scripts/replay-conversation.ts <conversationId>
 *
 * Loads the conversation's TurnDebug payloads, re-runs deriveAndExpose over
 * every stored legality snapshot, and prints a diff table. Exit 1 iff any
 * same_version_drift is found (a cross_version_change is a changelog entry,
 * not a failure).
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { engineVersion } from '@/lib/engines/derive-and-expose'
import { recomputeAndDiff } from '@/lib/debug/recompute-diff'
import type { DebugTurn } from '@/lib/debug/reducer'

async function main() {
  const conversationId = process.argv[2]
  if (!conversationId) {
    console.error('usage: npx tsx scripts/replay-conversation.ts <conversationId>')
    process.exit(1)
  }
  const rows = await prisma.turnDebug.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { payload: true },
  })
  if (rows.length === 0) {
    console.error(`no TurnDebug rows for conversation ${conversationId}`)
    process.exit(1)
  }
  const turns = rows.map((r) => r.payload as unknown as DebugTurn)
  const snapshotCount = turns.reduce((n, t) => n + (t.legality?.length ?? 0), 0)
  const diffs = recomputeAndDiff(turns, { currentEngineVersion: engineVersion })

  console.log(`conversation ${conversationId}: ${turns.length} turns, ${snapshotCount} legality snapshots, engine ${engineVersion}`)
  if (diffs.length === 0) {
    console.log('==== replay: NO DIFFS — engine deterministic over stored snapshots ====')
    process.exit(0)
  }
  console.log('msg | point       | kind                 | stored ver | summary')
  for (const d of diffs) {
    const summary = [
      ...d.stateDiff.slice(0, 2),
      ...(d.actionsDiff.addedAvailable.length ? [`+${d.actionsDiff.addedAvailable.join(',')}`] : []),
      ...(d.actionsDiff.removedAvailable.length ? [`-${d.actionsDiff.removedAvailable.join(',')}`] : []),
      ...d.actionsDiff.blockedChanged,
    ].join(' · ')
    console.log(`${String(d.messageIndex).padEnd(3)} | ${d.point.padEnd(11)} | ${d.kind.padEnd(20)} | ${d.storedEngineVersion.padEnd(10)} | ${summary}`)
  }
  const drift = diffs.filter((d) => d.kind === 'same_version_drift').length
  console.log(drift > 0
    ? `\n==== replay: ${drift} same_version_drift diff(s) — BUG ====`
    : `\n==== replay: ${diffs.length} cross-version change(s) — behavioral changelog, not a failure ====`)
  process.exit(drift > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
