/**
 * Inactivity sweep (D2.9, contradiction #11): ACTIVE conversations whose
 * lastActivityAt is older than the window become ARCHIVED. Terminality is
 * time-based housekeeping, never a funnel outcome; a later turn reactivates
 * (lib/chat/turn-context.ts).
 *
 * Usage: npx tsx scripts/archive-inactive-conversations.ts
 * Window: CONVERSATION_IDLE_ARCHIVE_DAYS (default 30).
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'

export async function archiveInactiveConversations(
  options: { idleDays?: number } = {},
): Promise<number> {
  const idleDays = options.idleDays ?? Number(process.env.CONVERSATION_IDLE_ARCHIVE_DAYS ?? 30)
  const cutoff = new Date(Date.now() - idleDays * 86_400_000)
  const res = await prisma.conversation.updateMany({
    where: { status: 'ACTIVE', lastActivityAt: { lt: cutoff } },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
  })
  return res.count
}

// CLI entry — guarded so the test import does not trigger the sweep
if (process.argv[1]?.endsWith('archive-inactive-conversations.ts')) {
  archiveInactiveConversations()
    .then((n) => {
      console.log(`archived ${n} inactive conversation(s)`)
      process.exit(0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
