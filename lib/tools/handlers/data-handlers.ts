/**
 * Data Handlers — Customer data collection
 *
 * collect_customer_field: validates and saves individual customer fields,
 * then returns a uiAction for the next needed field (or success when done).
 */

import { prisma } from '@/lib/db'
import type { ToolHandler } from '@/lib/tools/types'

// ─────────────────────────────────────────────
// Field collection order
// ─────────────────────────────────────────────

const FIELD_ORDER = ['name', 'cnp', 'dateOfBirth', 'email', 'phone'] as const

type CollectableField = (typeof FIELD_ORDER)[number]

// ─────────────────────────────────────────────
// Field metadata for uiAction payloads
// ─────────────────────────────────────────────

const FIELD_META: Record<
  CollectableField,
  {
    label: { en: string; ro: string }
    type: 'text' | 'email' | 'tel' | 'date' | 'textarea'
    validation?: { pattern?: string; minLength?: number; maxLength?: number }
    placeholder?: { en: string; ro: string }
  }
> = {
  name: {
    label: { en: 'Full name', ro: 'Numele complet' },
    type: 'text',
    validation: { minLength: 2, maxLength: 100 },
    placeholder: { en: 'e.g. Ion Popescu', ro: 'ex. Ion Popescu' },
  },
  cnp: {
    label: { en: 'Personal identification number (CNP)', ro: 'Cod numeric personal (CNP)' },
    type: 'text',
    validation: { pattern: '^[1-9]\\d{12}$', minLength: 13, maxLength: 13 },
    placeholder: { en: '13-digit CNP', ro: 'CNP din 13 cifre' },
  },
  dateOfBirth: {
    label: { en: 'Date of birth', ro: 'Data nasterii' },
    type: 'date',
    placeholder: { en: 'YYYY-MM-DD', ro: 'AAAA-LL-ZZ' },
  },
  email: {
    label: { en: 'Email address', ro: 'Adresa de email' },
    type: 'email',
    validation: { pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$' },
    placeholder: { en: 'your@email.com', ro: 'email@exemplu.ro' },
  },
  phone: {
    label: { en: 'Phone number', ro: 'Numar de telefon' },
    type: 'tel',
    validation: { pattern: '^(\\+?40|0)\\d{9}$' },
    placeholder: { en: '+40 7XX XXX XXX', ro: '07XX XXX XXX' },
  },
}

// ─────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────

function validateField(
  field: string,
  value: string,
): { valid: boolean; error?: string } {
  const trimmed = value.trim()

  switch (field) {
    case 'name':
      if (trimmed.length < 2) return { valid: false, error: 'Name must be at least 2 characters.' }
      return { valid: true }

    case 'cnp': {
      const cnpPattern = /^[1-9]\d{12}$/
      if (!cnpPattern.test(trimmed)) {
        return { valid: false, error: 'CNP must be exactly 13 digits starting with 1-9.' }
      }
      return { valid: true }
    }

    case 'email': {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailPattern.test(trimmed)) {
        return { valid: false, error: 'Please enter a valid email address.' }
      }
      return { valid: true }
    }

    case 'phone': {
      const phonePattern = /^(\+?40|0)\d{9}$/
      if (!phonePattern.test(trimmed.replace(/[\s-]/g, ''))) {
        return { valid: false, error: 'Please enter a valid Romanian phone number.' }
      }
      return { valid: true }
    }

    case 'dateOfBirth': {
      const date = new Date(trimmed)
      if (isNaN(date.getTime())) {
        return { valid: false, error: 'Please enter a valid date.' }
      }
      // Check age 18-64
      const today = new Date()
      let age = today.getFullYear() - date.getFullYear()
      const monthDiff = today.getMonth() - date.getMonth()
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) {
        age--
      }
      if (age < 18) return { valid: false, error: 'Must be at least 18 years old.' }
      if (age > 64) return { valid: false, error: 'Must be 64 years old or younger.' }
      return { valid: true }
    }

    case 'address':
      if (!trimmed) return { valid: false, error: 'Address is required.' }
      return { valid: true }

    default:
      return { valid: true }
  }
}

// ─────────────────────────────────────────────
// collect_customer_field
// ─────────────────────────────────────────────

export const collectCustomerField: ToolHandler = async (args, context) => {
  const { field, value } = args as { field: string; value: string }

  try {
    // 1. Validate the field value
    const validation = validateField(field, value)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    const trimmedValue = value.trim()

    // 2. Save to Customer record — map field name to Customer model field
    const updateData: Record<string, unknown> = {}

    switch (field) {
      case 'name':
        updateData.name = trimmedValue
        break
      case 'cnp':
        updateData.cnp = trimmedValue
        break
      case 'email':
        updateData.email = trimmedValue
        break
      case 'phone':
        updateData.phone = trimmedValue.replace(/[\s-]/g, '')
        break
      case 'dateOfBirth':
        updateData.dateOfBirth = new Date(trimmedValue)
        break
      case 'address':
        // Expect JSON or plain string; store as JSON
        try {
          updateData.address = JSON.parse(trimmedValue)
        } catch {
          updateData.address = { raw: trimmedValue }
        }
        break
      default:
        return { success: false, error: `Unknown field: ${field}` }
    }

    await prisma.customer.update({
      where: { id: context.customerId },
      data: updateData,
    })

    // 3. Determine next needed field
    const customer = await prisma.customer.findUnique({
      where: { id: context.customerId },
      select: {
        name: true,
        cnp: true,
        dateOfBirth: true,
        email: true,
        phone: true,
      },
    })

    if (!customer) {
      return { success: false, error: 'Customer not found.' }
    }

    // Find the first field that is still null in the ordered list
    let nextField: CollectableField | null = null
    for (const f of FIELD_ORDER) {
      if (customer[f] === null || customer[f] === undefined) {
        nextField = f
        break
      }
    }

    // 4. If more fields needed: return uiAction show_data_field with next field
    if (nextField) {
      const meta = FIELD_META[nextField]
      return {
        success: true,
        data: {
          fieldSaved: field,
          nextField,
        },
        message: `${field} saved. Please provide ${nextField}.`,
        uiAction: {
          type: 'show_data_field',
          payload: {
            field: nextField,
            label: meta.label,
            type: meta.type,
            validation: meta.validation ?? null,
            placeholder: meta.placeholder ?? null,
          } as unknown as Record<string, unknown>,
        },
      }
    }

    // 5. All collected: update Customer.isAnonymous = false, return success
    await prisma.customer.update({
      where: { id: context.customerId },
      data: { isAnonymous: false },
    })

    return {
      success: true,
      data: {
        fieldSaved: field,
        allFieldsCollected: true,
      },
      message: 'All customer information collected successfully.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
