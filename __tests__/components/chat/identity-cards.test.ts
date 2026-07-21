import { describe, it, expect } from 'vitest'
import { buildUploadResultAction } from '@/components/chat/rich/document-upload-card'
import { buildOtpSubmitAction, buildOtpResendAction } from '@/components/chat/rich/otp-entry-card'
import { adaptAction } from '@/lib/chat/action-adapter'

describe('identity GUI cards (T29 — the emitted-but-never-rendered controls)', () => {
  it('a successful upload posts document_uploaded {documentId, status} → adapter → get_current_state refresh', () => {
    const action = buildUploadResultAction('id_card', { documentId: 'doc-1', status: 'validated' })
    expect(action).toEqual({ type: 'document_uploaded', payload: { kind: 'id_card', documentId: 'doc-1', status: 'validated' } })
    // the pipeline already ran server-side in the upload route — the GUI
    // event refreshes the derived state so exposure sees the validated doc
    expect(adaptAction(action)).toMatchObject({ name: 'get_current_state', arguments: {} })
  })

  it('otp submit requires exactly 6 digits and round-trips to confirm_channel_verification', () => {
    expect(buildOtpSubmitAction('12345')).toBeNull()
    expect(buildOtpSubmitAction('1234567')).toBeNull()
    expect(buildOtpSubmitAction('12345a')).toBeNull()
    expect(buildOtpSubmitAction('')).toBeNull()
    const action = buildOtpSubmitAction('123456')
    expect(action).toEqual({ type: 'otp_submit', payload: { code: '123456' } })
    expect(adaptAction(action!)).toMatchObject({ name: 'confirm_channel_verification', arguments: { code: '123456' } })
  })

  it('otp submit threads the channel so the card-view submitting key is truthful (adapter ignores it)', () => {
    const action = buildOtpSubmitAction('123456', 'sms')
    expect(action).toEqual({ type: 'otp_submit', payload: { code: '123456', channel: 'sms' } })
    expect(adaptAction(action!)).toMatchObject({ name: 'confirm_channel_verification', arguments: { code: '123456' } })
  })

  it('the resend affordance round-trips to start_channel_verification with resend:true (verificationResendEscape)', () => {
    const action = buildOtpResendAction('email', 'otp@example.ro')
    expect(action).toEqual({ type: 'otp_resend', payload: { channel: 'email', target: 'otp@example.ro' } })
    expect(adaptAction(action)).toMatchObject({
      name: 'start_channel_verification',
      arguments: { channel: 'email', target: 'otp@example.ro', resend: true },
    })
  })
})
