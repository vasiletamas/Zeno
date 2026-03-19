import { describe, it, expect } from 'vitest'
import {
  shouldShowQuestion,
  validateAnswer,
  checkForFlags,
} from '@/lib/engines/questionnaire-engine'

// ==========================================
// shouldShowQuestion
// ==========================================

describe('shouldShowQuestion', () => {
  it('returns true when question has no parent', () => {
    const result = shouldShowQuestion(
      { parentQuestionId: null, showWhenValue: null },
      new Map(),
    )
    expect(result).toBe(true)
  })

  it('returns true when parent answered with matching value', () => {
    const answersMap = new Map([['parent-1', 'yes']])
    const result = shouldShowQuestion(
      { parentQuestionId: 'parent-1', showWhenValue: 'yes' },
      answersMap,
    )
    expect(result).toBe(true)
  })

  it('returns false when parent answered with non-matching value', () => {
    const answersMap = new Map([['parent-1', 'no']])
    const result = shouldShowQuestion(
      { parentQuestionId: 'parent-1', showWhenValue: 'yes' },
      answersMap,
    )
    expect(result).toBe(false)
  })

  it('returns false when parent not answered', () => {
    const result = shouldShowQuestion(
      { parentQuestionId: 'parent-1', showWhenValue: 'yes' },
      new Map(),
    )
    expect(result).toBe(false)
  })

  it('returns true when parent answered and showWhenValue is null', () => {
    const answersMap = new Map([['parent-1', 'anything']])
    const result = shouldShowQuestion(
      { parentQuestionId: 'parent-1', showWhenValue: null },
      answersMap,
    )
    expect(result).toBe(true)
  })

  it('matches boolean showWhenValue "true" with normalized answer "da"', () => {
    const answersMap = new Map([['parent-1', 'true']])
    const result = shouldShowQuestion(
      { parentQuestionId: 'parent-1', showWhenValue: 'true' },
      answersMap,
    )
    expect(result).toBe(true)
  })

  it('matches comma-separated showWhenValue', () => {
    const answersMap = new Map([['parent-1', 'quite_important']])
    const result = shouldShowQuestion(
      { parentQuestionId: 'parent-1', showWhenValue: 'somewhat,quite_important,very_important' },
      answersMap,
    )
    expect(result).toBe(true)
  })

  it('rejects comma-separated showWhenValue when not matching', () => {
    const answersMap = new Map([['parent-1', 'not_necessary']])
    const result = shouldShowQuestion(
      { parentQuestionId: 'parent-1', showWhenValue: 'somewhat,quite_important,very_important' },
      answersMap,
    )
    expect(result).toBe(false)
  })
})

// ==========================================
// validateAnswer
// ==========================================

describe('validateAnswer', () => {
  describe('BOOLEAN', () => {
    const boolQuestion = { type: 'BOOLEAN', options: null, validationRules: null }

    it('normalizes "da" to "true"', () => {
      const result = validateAnswer(boolQuestion, 'da')
      expect(result).toEqual({ valid: true, normalizedValue: 'true' })
    })

    it('normalizes "nu" to "false"', () => {
      const result = validateAnswer(boolQuestion, 'nu')
      expect(result).toEqual({ valid: true, normalizedValue: 'false' })
    })

    it('normalizes "yes" to "true"', () => {
      const result = validateAnswer(boolQuestion, 'yes')
      expect(result).toEqual({ valid: true, normalizedValue: 'true' })
    })

    it('normalizes "no" to "false"', () => {
      const result = validateAnswer(boolQuestion, 'no')
      expect(result).toEqual({ valid: true, normalizedValue: 'false' })
    })

    it('normalizes "1" to "true"', () => {
      const result = validateAnswer(boolQuestion, '1')
      expect(result).toEqual({ valid: true, normalizedValue: 'true' })
    })

    it('normalizes "0" to "false"', () => {
      const result = validateAnswer(boolQuestion, '0')
      expect(result).toEqual({ valid: true, normalizedValue: 'false' })
    })

    it('rejects invalid boolean value', () => {
      const result = validateAnswer(boolQuestion, 'maybe')
      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('DROPDOWN', () => {
    const dropdownQuestion = {
      type: 'DROPDOWN',
      options: [
        { value: 'standard', label: { en: 'Standard', ro: 'Standard' } },
        { value: 'optim', label: { en: 'Optim', ro: 'Optim' } },
      ],
      validationRules: null,
    }

    it('accepts a valid option', () => {
      const result = validateAnswer(dropdownQuestion, 'standard')
      expect(result).toEqual({ valid: true, normalizedValue: 'standard' })
    })

    it('rejects an invalid option', () => {
      const result = validateAnswer(dropdownQuestion, 'premium')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid option')
    })

    it('matches case-insensitively', () => {
      const result = validateAnswer(dropdownQuestion, 'STANDARD')
      expect(result).toEqual({ valid: true, normalizedValue: 'standard' })
    })

    it('matches label text', () => {
      const result = validateAnswer(dropdownQuestion, 'Optim')
      expect(result).toEqual({ valid: true, normalizedValue: 'optim' })
    })
  })

  describe('DROPDOWN with Romanian diacritics', () => {
    const roDropdown = {
      type: 'DROPDOWN',
      options: [
        { value: 'employee', label: { en: 'Employee', ro: 'Angajat' } },
        { value: 'unemployed', label: { en: 'Unemployed', ro: 'Șomer' } },
        { value: 'freelancer', label: { en: 'Freelancer', ro: 'Liber Profesionist' } },
      ],
      validationRules: null,
    }

    it('fuzzy matches Romanian with stripped diacritics', () => {
      // "Somer" should match "Șomer"
      const result = validateAnswer(roDropdown, 'Somer')
      expect(result).toEqual({ valid: true, normalizedValue: 'unemployed' })
    })
  })

  describe('MULTI_SELECT', () => {
    const multiQuestion = {
      type: 'MULTI_SELECT',
      options: [
        { value: 'salary_pension', label: { en: 'Salary/Pension', ro: 'Salariu/Pensie' } },
        { value: 'other_sources', label: { en: 'Other sources', ro: 'Alte surse' } },
      ],
      validationRules: null,
    }

    it('accepts valid comma-separated values', () => {
      const result = validateAnswer(multiQuestion, 'salary_pension,other_sources')
      expect(result.valid).toBe(true)
      expect(result.normalizedValue).toBe('salary_pension,other_sources')
    })

    it('rejects if any value is invalid', () => {
      const result = validateAnswer(multiQuestion, 'salary_pension,invalid_option')
      expect(result.valid).toBe(false)
    })
  })

  describe('NUMBER', () => {
    const numberQuestion = {
      type: 'NUMBER',
      options: null,
      validationRules: { min: 18, max: 64 },
    }

    it('accepts a number within range', () => {
      const result = validateAnswer(numberQuestion, '30')
      expect(result).toEqual({ valid: true, normalizedValue: '30' })
    })

    it('rejects a number below min', () => {
      const result = validateAnswer(numberQuestion, '15')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('at least 18')
    })

    it('rejects a number above max', () => {
      const result = validateAnswer(numberQuestion, '70')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('at most 64')
    })

    it('rejects non-numeric input', () => {
      const result = validateAnswer(numberQuestion, 'abc')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('valid number')
    })
  })

  describe('OPEN_ENDED', () => {
    const openQuestion = {
      type: 'OPEN_ENDED',
      options: null,
      validationRules: { minLength: 13, maxLength: 13, pattern: '^[1-9]\\d{12}$' },
    }

    it('accepts a valid CNP pattern', () => {
      const result = validateAnswer(openQuestion, '1234567890123')
      expect(result.valid).toBe(true)
      expect(result.normalizedValue).toBe('1234567890123')
    })

    it('rejects when too short', () => {
      const result = validateAnswer(openQuestion, '12345')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('at least 13')
    })

    it('rejects when pattern does not match', () => {
      const result = validateAnswer(openQuestion, '0234567890123')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid format')
    })
  })

  describe('DATE', () => {
    const dateQuestion = { type: 'DATE', options: null, validationRules: null }

    it('accepts a valid date', () => {
      const result = validateAnswer(dateQuestion, '2000-01-15')
      expect(result.valid).toBe(true)
      expect(result.normalizedValue).toContain('2000-01-15')
    })

    it('rejects an invalid date', () => {
      const result = validateAnswer(dateQuestion, 'not-a-date')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('valid date')
    })
  })

  describe('empty value', () => {
    it('rejects empty string', () => {
      const result = validateAnswer({ type: 'BOOLEAN', options: null, validationRules: null }, '')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('required')
    })

    it('rejects whitespace-only', () => {
      const result = validateAnswer({ type: 'BOOLEAN', options: null, validationRules: null }, '   ')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('required')
    })
  })
})

// ==========================================
// checkForFlags
// ==========================================

describe('checkForFlags', () => {
  it('returns flagged when value matches a flag rule', () => {
    const rules = {
      flagAnswers: [
        { value: 'false', action: 'escalate', reason: 'Customer declared existing health conditions' },
      ],
    }
    const result = checkForFlags(rules, 'false')
    expect(result).toEqual({
      flagged: true,
      action: 'escalate',
      reason: 'Customer declared existing health conditions',
    })
  })

  it('returns not flagged when no match', () => {
    const rules = {
      flagAnswers: [
        { value: 'false', action: 'escalate', reason: 'Health condition' },
      ],
    }
    const result = checkForFlags(rules, 'true')
    expect(result).toEqual({ flagged: false, action: null, reason: null })
  })

  it('returns not flagged when no flags in rules', () => {
    const result = checkForFlags({ riskWeight: 5.0 }, 'true')
    expect(result).toEqual({ flagged: false, action: null, reason: null })
  })

  it('returns not flagged when validationRules is null', () => {
    const result = checkForFlags(null, 'true')
    expect(result).toEqual({ flagged: false, action: null, reason: null })
  })

  it('matches boolean normalized value for "true" flag against "da"', () => {
    const rules = {
      flagAnswers: [
        { value: 'true', action: 'reject', reason: 'BD medical condition detected' },
      ],
    }
    const result = checkForFlags(rules, 'da')
    expect(result).toEqual({
      flagged: true,
      action: 'reject',
      reason: 'BD medical condition detected',
    })
  })

  it('defaults action to "flag" when not specified', () => {
    const rules = {
      flagAnswers: [{ value: 'yes', reason: 'Review needed' }],
    }
    const result = checkForFlags(rules, 'yes')
    expect(result.flagged).toBe(true)
    expect(result.action).toBe('flag')
  })
})
