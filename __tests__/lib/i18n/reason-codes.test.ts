import { it, expect } from 'vitest'
import { REASON_CODES } from '@/lib/engines/domain-types'
import { translations } from '@/lib/i18n/translations'

it('every ReasonCode has ro+en GUI strings', () => {
  for (const code of REASON_CODES) {
    expect(translations.ro.reasonCodes?.[code], code).toBeTruthy()
    expect(translations.en.reasonCodes?.[code], code).toBeTruthy()
  }
})
