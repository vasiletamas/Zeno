/**
 * P0-1 write-guard (handler layer): before an AGENT-actor commit persists a
 * customer value, the pure grounding module checks it is anchored in the
 * customer's recent words (or a proposal the customer confirmed). GUI and
 * operator actors bypass — a card click or operator entry IS first-party
 * input. One shared helper for the four value-writing commits
 * (write_dnt_answer, write_question_answer, modify_answer,
 * collect_customer_field) so the rule cannot drift per handler.
 */
import { isValueGrounded, type GroundingOption } from '@/lib/engines/anti-fabrication'
import type { ToolContext } from '@/lib/tools/types'

// window sizes are deliberate: wide enough for multi-answer replies and the
// propose-then-confirm round-trip, narrow enough that an anchor from another
// funnel stage cannot launder a fabrication
const USER_WINDOW = 6
const ASSISTANT_WINDOW = 4

export async function valueNotGroundedError(
  context: ToolContext,
  value: string,
  options?: GroundingOption[],
  storedValue?: string | null,
): Promise<string | null> {
  if ((context.actor ?? 'agent') !== 'agent') return null
  const recent = await context.db.message.findMany({
    where: { conversationId: context.conversationId },
    orderBy: { createdAt: 'desc' },
    take: 24,
    select: { role: true, content: true },
  })
  const ordered = [...recent].reverse()
  const userMessages = ordered.filter((m) => m.role === 'user').slice(-USER_WINDOW).map((m) => m.content)
  const assistantMessages = ordered.filter((m) => m.role === 'assistant').slice(-ASSISTANT_WINDOW).map((m) => m.content)
  const r = isValueGrounded({ value, options, storedValue, userMessages, assistantMessages })
  if (r.grounded) return null
  return (
    `value_not_grounded: "${value}" appears in neither the customer's recent messages nor a proposal the customer confirmed. ` +
    'NEVER invent a value — ask the question, or present the value and get an explicit "da" before writing it.'
  )
}
