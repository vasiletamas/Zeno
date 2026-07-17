/**
 * T20 (P3.5): channel availability derives from provider config — ONE source
 * of truth. Evidence (2026-07-15, conv cmrm3fgku00056g0y4eb2hsme msg 71-74):
 * the agent OFFERED an SMS code, then refused it with zero tool calls,
 * because the tool description advertised "email address or phone number"
 * while the handler hard-rejects sms. The manifest, the zod schema, and the
 * description now all derive from availableVerificationChannels().
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { availableVerificationChannels } from '@/lib/channels/availability'
import { validateToolArgs } from '@/lib/tools/validation'
import { getToolDefinition } from '@/lib/tools/registry'

const ORIGINAL_SMS_PROVIDER = process.env.SMS_PROVIDER

describe('availableVerificationChannels', () => {
  beforeEach(() => {
    delete process.env.SMS_PROVIDER
  })
  afterEach(() => {
    if (ORIGINAL_SMS_PROVIDER === undefined) delete process.env.SMS_PROVIDER
    else process.env.SMS_PROVIDER = ORIGINAL_SMS_PROVIDER
  })

  it('email is always available (mock counts as deliverable in dev)', () => {
    expect(availableVerificationChannels()).toEqual(['email'])
  })

  it('a blank SMS_PROVIDER is NOT a configured provider', () => {
    process.env.SMS_PROVIDER = ''
    expect(availableVerificationChannels()).toEqual(['email'])
    process.env.SMS_PROVIDER = '   '
    expect(availableVerificationChannels()).toEqual(['email'])
  })

  it('sms joins ONLY when an SMS provider is configured', () => {
    process.env.SMS_PROVIDER = 'twilio'
    expect(availableVerificationChannels()).toEqual(['email', 'sms'])
  })
})

describe('start_channel_verification schema derives from availability (T20)', () => {
  // No SMS provider exists today, so the module-load evaluation of the
  // schema sees email-only. These assertions pin TODAY'S surface.
  it('rejects channel "sms" with a message pointing to email', () => {
    const r = validateToolArgs('start_channel_verification', {
      channel: 'sms',
      target: '0712345678',
    })
    expect(r.valid).toBe(false)
    expect(r.errors?.join(' ')).toMatch(/email/i)
  })

  it('accepts channel "email"', () => {
    const r = validateToolArgs('start_channel_verification', {
      channel: 'email',
      target: 'client@example.ro',
    })
    expect(r.valid).toBe(true)
  })
})

describe('start_channel_verification manifest derives from availability (T20)', () => {
  it('the description names exactly the available channels — no "or phone number" while email-only', () => {
    const def = getToolDefinition('start_channel_verification')!
    expect(def.description).toContain('email address')
    expect(def.description).not.toMatch(/phone number/i)
    expect(def.description).not.toMatch(/\bsms\b/i)
  })

  it('the channel param enum lists ONLY the available channels', () => {
    const def = getToolDefinition('start_channel_verification')!
    const params = def.parameters as {
      properties: { channel: { enum: string[]; description: string } }
    }
    expect(params.properties.channel.enum).toEqual(['email'])
    expect(params.properties.channel.description).toMatch(/email/)
  })
})
