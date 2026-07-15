/**
 * P0-2 (2026-07-15 hardening): a handler that WRITES and then FAILS must not
 * commit the partial write. The gateway converts handler failures (returned
 * {success:false} and unexpected throws) into a rollback of the whole apply
 * transaction, then writes the rejection ledger row in a SEPARATE transaction
 * — exactly one row, safe envelope returned.
 *
 * The deliberate exception (T7.D4): generate_quote records its quoteDecision
 * as an audit fact even when the decision refuses — handlers opt into that
 * with ToolResult.keepWrites, pinned here with a scratch tool.
 *
 * Scratch tools are operator-gated (OPERATOR_TOOLS) so exposure-based
 * legality is replaced by the actor gate — no funnel fixture needed.
 */
import { it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit, OPERATOR_TOOLS } from '@/lib/tools/gateway'
import { registerTool } from '@/lib/tools/registry'
import type { ToolContext, ToolResult } from '@/lib/tools/types'

const REJECT_TOOL = '__test_partial_write_reject__'
const THROW_TOOL = '__test_partial_write_throw__'
const KEEP_TOOL = '__test_partial_write_keep__'

const writeInsight = async (context: ToolContext) => {
  await context.db.customerInsight.create({
    data: {
      customerId: context.customerId,
      category: 'DEMOGRAPHIC',
      key: 'partial-write-probe',
      value: 'written-before-failure',
      confidence: 1,
      source: 'test',
      lastConfirmedAt: new Date(),
    },
  })
}

const scratchDef = {
  description: 'test-only partial-write tool',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  executionMode: 'blocking' as const,
  kind: 'commit' as const,
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ['OPERATOR' as const],
}

beforeAll(() => {
  registerTool(REJECT_TOOL, scratchDef, async (_args, context): Promise<ToolResult> => {
    await writeInsight(context)
    return { success: false, error: 'boom: intentional rejection after write' }
  })
  registerTool(THROW_TOOL, scratchDef, async (_args, context): Promise<ToolResult> => {
    await writeInsight(context)
    throw new Error('kaboom: unexpected throw after write')
  })
  registerTool(KEEP_TOOL, scratchDef, async (_args, context): Promise<ToolResult> => {
    await writeInsight(context)
    return { success: false, error: 'boom: audit write must survive', keepWrites: true }
  })
  OPERATOR_TOOLS.add(REJECT_TOOL)
  OPERATOR_TOOLS.add(THROW_TOOL)
  OPERATOR_TOOLS.add(KEEP_TOOL)
})

afterAll(() => {
  OPERATOR_TOOLS.delete(REJECT_TOOL)
  OPERATOR_TOOLS.delete(THROW_TOOL)
  OPERATOR_TOOLS.delete(KEEP_TOOL)
})

beforeEach(async () => {
  await resetDb()
})

async function fixture() {
  const customer = await createCustomer()
  const conversation = await prisma.conversation.create({ data: { customerId: customer.id } })
  const context = {
    customerId: customer.id,
    conversationId: conversation.id,
    language: 'ro',
    db: prisma,
    actor: 'operator',
  } as unknown as ToolContext
  return { customer, conversation, context }
}

it('a handler returning {success:false} after writing rolls the write back and ledgers exactly one rejected row', async () => {
  const { customer, conversation, context } = await fixture()
  const result = await executeCommit({
    tool: REJECT_TOOL, args: {}, actor: 'operator',
    conversationId: conversation.id, customerId: customer.id, toolContext: context,
  })
  expect(result.outcome).toBe('rejected')
  expect(result.reason).toBe('handler_rejected')
  expect(String((result.data as { error?: string })?.error)).toContain('boom')
  // the partial write must NOT have committed
  expect(await prisma.customerInsight.count({ where: { customerId: customer.id } })).toBe(0)
  const rows = await prisma.commitLedger.findMany({ where: { conversationId: conversation.id } })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ tool: REJECT_TOOL, outcome: 'rejected', reasonCode: 'handler_rejected', idempotencyDisposition: 'fresh' })
})

it('an unexpected handler throw after writing rolls back, returns a safe rejected envelope, and ledgers exactly one row', async () => {
  const { customer, conversation, context } = await fixture()
  const result = await executeCommit({
    tool: THROW_TOOL, args: {}, actor: 'operator',
    conversationId: conversation.id, customerId: customer.id, toolContext: context,
  })
  expect(result.outcome).toBe('rejected')
  expect(result.reason).toBe('handler_rejected')
  expect(String((result.data as { error?: string })?.error)).toContain('kaboom')
  expect(await prisma.customerInsight.count({ where: { customerId: customer.id } })).toBe(0)
  const rows = await prisma.commitLedger.findMany({ where: { conversationId: conversation.id } })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ tool: THROW_TOOL, outcome: 'rejected', reasonCode: 'handler_rejected' })
})

it('keepWrites: a handler-declared audit write survives its own rejection (T7.D4 generate_quote contract)', async () => {
  const { customer, conversation, context } = await fixture()
  const result = await executeCommit({
    tool: KEEP_TOOL, args: {}, actor: 'operator',
    conversationId: conversation.id, customerId: customer.id, toolContext: context,
  })
  expect(result.outcome).toBe('rejected')
  expect(await prisma.customerInsight.count({ where: { customerId: customer.id } })).toBe(1)
  const rows = await prisma.commitLedger.findMany({ where: { conversationId: conversation.id } })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ tool: KEEP_TOOL, outcome: 'rejected' })
})
