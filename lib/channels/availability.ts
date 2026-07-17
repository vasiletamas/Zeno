/**
 * Channel availability — the ONE source of truth (T20, P3.5).
 *
 * Evidence (2026-07-15, conv cmrm3fgku00056g0y4eb2hsme msg 71-74): the agent
 * OFFERED an SMS code, then on "da" refused with zero tool calls — the tool
 * description advertised "email address or phone number", the handler
 * hard-rejected sms, and the constitution's blanket messaging ban made the
 * model refuse from memory. Three layers, three stories.
 *
 * A verification channel is available ONLY when its delivery provider is
 * configured. The tool manifest (registry.ts), the zod schema
 * (validation.ts) and the handler's defense-in-depth reject all derive from
 * this function, so they can never disagree again.
 */

export type VerificationChannel = 'email' | 'sms'

/**
 * The verification channels with a configured delivery provider.
 *
 * - email: always available — EMAIL_PROVIDER defaults to 'mock', and the
 *   mock provider counts as deliverable in dev/test (lib/email/index.ts).
 * - sms: only when SMS_PROVIDER names a configured provider. No SMS provider
 *   module exists today, so production is email-only until one lands.
 */
export function availableVerificationChannels(): VerificationChannel[] {
  const channels: VerificationChannel[] = ['email']
  const smsProvider = process.env.SMS_PROVIDER
  if (typeof smsProvider === 'string' && smsProvider.trim() !== '') {
    channels.push('sms')
  }
  return channels
}
