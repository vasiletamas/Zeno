/**
 * uiAction parity ratchet (T29). The 2026-07-15 incident: handlers emitted
 * show_document_upload/show_otp_entry, rich-content's silent default dropped
 * them, and the customer was told to use a control that never rendered. The
 * registry is the single source of truth; this test scans the renderer and
 * handler SOURCES so none of the three surfaces can drift unregistered.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  EMITTED_UI_ACTION_TYPES,
  RENDER_ONLY_UI_ACTION_TYPES,
  RENDERED_UI_ACTION_TYPES,
  CLIENT_POSTED_ACTION_TYPES,
  KNOWN_UNADAPTED_CLIENT_ACTIONS,
} from '@/lib/chat/ui-action-registry'
import { adaptAction } from '@/lib/chat/action-adapter'

const repoPath = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url))

/** The renderer's actual `case '...'` literals — the ground truth RENDERED must mirror. */
const rendererCases = [
  ...readFileSync(repoPath('components/chat/rich/rich-content.tsx'), 'utf8').matchAll(/case '([a-z_]+)'/g),
].map((m) => m[1])

/** Every uiAction type literal the handlers/orchestrator sources emit. */
const emittedInSource = () => {
  const files = readdirSync(repoPath('lib/tools/handlers'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => repoPath(`lib/tools/handlers/${f}`))
  files.push(repoPath('lib/chat/orchestrator.ts'))
  return files.flatMap((f) => [
    ...readFileSync(f, 'utf8').matchAll(/type:\s*'((?:show_[a-z_]+)|confirm_required)'/g),
  ].map((m) => m[1]))
}

/** Minimal adaptable payload per client-posted type — keyed exactly by the registry. */
const CLIENT_ACTION_FIXTURES: Record<string, Record<string, unknown>> = {
  select_tier: { tierCode: 'standard', levelCode: 'l1' },
  answer_question: { answer: 'da', questionId: 'q1', questionCode: 'DNT_CNP', groupType: 'application' },
  medical_batch: { answers: { BD_CANCER_HISTORY: 'false', BD_CARDIOVASCULAR: 'true' } },
  accept_quote: { paymentOption: 'annual' },
  cancel_quote: {},
  submit_field: { field: 'email', value: 'a@b.ro' },
  otp_submit: { code: '123456' },
  otp_resend: { channel: 'email', target: 'a@b.ro' },
  document_uploaded: { documentId: 'doc-1', status: 'validated' },
  sign_dnt: { consent: { gdpr: true, aiDisclosure: true }, confirmToken: 't' },
  write_question_answer: { answer: 'da', questionCode: 'BD_CANCER_HISTORY', confirmToken: 't' },
  modify_answer: { questionCode: 'BD_CANCER_HISTORY', newValue: 'nu', confirmToken: 't' },
  sign_medical_declarations: { confirmToken: 't' },
  cancel_application: { confirmToken: 't' },
  change_payment_option: { paymentOption: 'quarterly', confirmToken: 't' },
  request_cancellation: { confirmToken: 't' },
  payment_complete: { paymentId: 'p1' },
}

describe('uiAction parity (T29)', () => {
  it('every emitted type has a renderer case (2026-07-15: show_document_upload/show_otp_entry were dropped silently)', () => {
    for (const type of EMITTED_UI_ACTION_TYPES) {
      expect(rendererCases, `emitted type '${type}' has no rich-content case`).toContain(type)
    }
  })

  it('the RENDERED registry list mirrors the renderer switch exactly (drift in either direction fails)', () => {
    expect(new Set(rendererCases)).toEqual(new Set(RENDERED_UI_ACTION_TYPES))
  })

  it('RENDERED === EMITTED ∪ RENDER_ONLY — no unaccounted renderer cases', () => {
    expect(new Set(RENDERED_UI_ACTION_TYPES)).toEqual(
      new Set([...EMITTED_UI_ACTION_TYPES, ...RENDER_ONLY_UI_ACTION_TYPES]),
    )
  })

  it('every uiAction type literal in handler/orchestrator source is registered as EMITTED', () => {
    for (const type of emittedInSource()) {
      expect(EMITTED_UI_ACTION_TYPES, `source emits unregistered uiAction type '${type}'`).toContain(type)
    }
  })

  it('every client-posted action type adapts to a tool call', () => {
    // the fixture map must cover the registry exactly, so a new posted type
    // forces a fixture (and thereby an adapter case) here
    expect(Object.keys(CLIENT_ACTION_FIXTURES).sort()).toEqual([...CLIENT_POSTED_ACTION_TYPES].sort())
    for (const type of CLIENT_POSTED_ACTION_TYPES) {
      expect(adaptAction({ type, payload: CLIENT_ACTION_FIXTURES[type] }), `client action '${type}' has no adapter case`).not.toBeNull()
    }
  })

  it('known-unadapted actions do NOT adapt (empty since T30 adapted payment_complete)', () => {
    for (const type of KNOWN_UNADAPTED_CLIENT_ACTIONS) {
      expect(adaptAction({ type, payload: { paymentId: 'p1' } })).toBeNull()
      expect(CLIENT_POSTED_ACTION_TYPES).not.toContain(type)
    }
  })

  it('registry lists contain no duplicates and EMITTED/RENDER_ONLY are disjoint', () => {
    for (const list of [EMITTED_UI_ACTION_TYPES, RENDER_ONLY_UI_ACTION_TYPES, RENDERED_UI_ACTION_TYPES, CLIENT_POSTED_ACTION_TYPES]) {
      expect(new Set(list).size).toBe(list.length)
    }
    expect(EMITTED_UI_ACTION_TYPES.filter((t) => RENDER_ONLY_UI_ACTION_TYPES.includes(t))).toEqual([])
  })
})
