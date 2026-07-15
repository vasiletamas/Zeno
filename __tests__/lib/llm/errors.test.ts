import { describe, it, expect } from 'vitest'
import {
  classifyError,
  shouldFailover,
  isRetryable,
  isContextLengthError,
  parseTokenDeficit,
} from '@/lib/llm/errors'
import { AGENTS } from '@/prisma/seeds/seed-agents'

// P1-8: a 404 (retired model / dead endpoint) must trigger FAILOVER — it
// previously classified 'unknown' (no retry, no failover), so a dead primary
// model killed the customer turn outright.
describe('classifyError (P1-8)', () => {
  it('404 model-not-found classifies provider_down and fails over', () => {
    const c = classifyError({ status: 404, message: 'The model `claude-sonnet-4-20250514` does not exist' })
    expect(c).toBe('provider_down')
    expect(shouldFailover(c)).toBe(true)
    expect(isRetryable(c)).toBe(false)
  })
  it('keeps the existing class map intact', () => {
    expect(classifyError({ status: 429 })).toBe('transient')
    expect(classifyError({ status: 400 })).toBe('validation')
    expect(classifyError({ status: 503 })).toBe('transient')
    expect(classifyError({ status: 401 })).toBe('provider_down')
  })
})

describe('seeded failover models (P1-8)', () => {
  const RETIRED = ['claude-sonnet-4-20250514']
  it('no agent runs on or fails over to a retired model', () => {
    for (const a of AGENTS) {
      expect(RETIRED, `${a.slug} fallbackModel`).not.toContain(a.fallbackModel)
      expect(RETIRED, `${a.slug} model`).not.toContain(a.model)
    }
  })
  it('main-chat fails over to the current Sonnet', () => {
    expect(AGENTS.find((a) => a.slug === 'main-chat')?.fallbackModel).toBe('claude-sonnet-5')
  })
})

describe('isContextLengthError', () => {
  it('detects OpenAI context_length_exceeded error', () => {
    const err = {
      status: 400,
      code: 'context_length_exceeded',
      message: "This model's maximum context length is 128000 tokens. However, your messages resulted in 135000 tokens.",
    }
    expect(isContextLengthError(err)).toBe(true)
  })

  it('detects Anthropic prompt too long error', () => {
    const err = {
      status: 400,
      message: 'prompt is too long: 150000 tokens > 128000 maximum',
    }
    expect(isContextLengthError(err)).toBe(true)
  })

  it('returns false for regular 400 errors', () => {
    const err = {
      status: 400,
      message: 'invalid parameter: temperature must be between 0 and 2',
    }
    expect(isContextLengthError(err)).toBe(false)
  })

  it('returns false for non-400 errors', () => {
    const err = {
      status: 500,
      message: 'internal server error',
    }
    expect(isContextLengthError(err)).toBe(false)
  })
})

describe('parseTokenDeficit', () => {
  it('parses OpenAI format: "resulted in X tokens" vs "maximum context length is Y"', () => {
    const err = {
      message: "This model's maximum context length is 128000 tokens. However, your messages resulted in 135000 tokens.",
    }
    expect(parseTokenDeficit(err)).toBe(7000)
  })

  it('parses Anthropic format: "X tokens > Y maximum"', () => {
    const err = {
      message: 'prompt is too long: 150000 tokens > 128000 maximum',
    }
    expect(parseTokenDeficit(err)).toBe(22000)
  })

  it('returns null for unparseable messages', () => {
    const err = { message: 'something went wrong' }
    expect(parseTokenDeficit(err)).toBeNull()
  })
})
