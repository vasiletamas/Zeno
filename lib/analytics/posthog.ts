/**
 * PostHog Server-Side Client (Singleton)
 *
 * Returns null if POSTHOG_API_KEY is not set — all callers must handle null.
 * Uses eu.posthog.com for GDPR-compliant EU data residency.
 */

import { PostHog } from 'posthog-node'

let posthogClient: PostHog | null = null

export function getPostHog(): PostHog | null {
  if (!process.env.POSTHOG_API_KEY) return null
  if (!posthogClient) {
    posthogClient = new PostHog(process.env.POSTHOG_API_KEY, {
      host: process.env.POSTHOG_HOST || 'https://eu.posthog.com',
    })
  }
  return posthogClient
}
