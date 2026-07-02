/**
 * B3.ADD-2 — identity uiAction renderers + gui adapter mappings (M4/T4-R3):
 * the OTP entry and document upload are GUI controls; their submissions
 * come back through the action adapter as gateway commits with actor=gui.
 */
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, createCustomer } from '@/__tests__/helpers/test-db'
import { startChannelVerification, requestDocumentUpload } from '@/lib/tools/handlers/identity-handlers'
import { adaptAction } from '@/lib/chat/action-adapter'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetFunnelTables() })

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

it('start_channel_verification renders show_otp_entry with the channel', async () => {
  const c = await createCustomer()
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  const r = await startChannelVerification({ channel: 'email', target: 'otp@example.ro' }, ctx(c.id, conv.id))
  expect(r.success).toBe(true)
  expect(r.uiAction).toMatchObject({ type: 'show_otp_entry', payload: { channel: 'email' } })
})

it('request_document_upload renders show_document_upload with kind + uploadUrl', async () => {
  const c = await createCustomer()
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  const r = await requestDocumentUpload({ kind: 'id_card' }, ctx(c.id, conv.id))
  expect(r.success).toBe(true)
  expect(r.uiAction).toMatchObject({ type: 'show_document_upload', payload: { kind: 'id_card', uploadUrl: '/api/documents/upload' } })
})

it('the adapter maps otp_submit to the confirm commit and document_uploaded to a state refresh', () => {
  const otp = adaptAction({ type: 'otp_submit', payload: { code: '123456' } })
  expect(otp).toMatchObject({ name: 'confirm_channel_verification', arguments: { code: '123456' } })
  // the pipeline already ran server-side in the upload route — the GUI event
  // just refreshes the derived state so exposure sees the validated document
  const uploaded = adaptAction({ type: 'document_uploaded', payload: { documentId: 'doc-1' } })
  expect(uploaded).toMatchObject({ name: 'get_current_state' })
})
