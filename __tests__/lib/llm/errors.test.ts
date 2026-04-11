import { describe, it, expect } from 'vitest'
import {
  isContextLengthError,
  parseTokenDeficit,
} from '@/lib/llm/errors'

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
