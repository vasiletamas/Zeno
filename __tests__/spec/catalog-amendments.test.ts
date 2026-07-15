import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const md = fs.readFileSync(path.join(process.cwd(), 'docs/tools as wokflow scenarios/zeno_tool_catalog.md'), 'utf8')

describe('zeno_tool_catalog.md reflects every logged spec amendment', () => {
  it('(2) taxonomy split into outcome + effects and includes unavailable/pending', () => {
    expect(md).toMatch(/outcome/i)
    expect(md).toMatch(/effects/i)
    expect(md).toMatch(/\bunavailable\b/)
    expect(md).toMatch(/\bpending\b/)
    expect(md).not.toMatch(/returned by every commit\)/) // singular-consequence framing retired
  })
  it('(4)(5) DNT surface is the pinned 6-tool set with customer-scoped exposure', () => {
    expect(md).toMatch(/open_dnt_session/)
    expect(md).not.toMatch(/\bstart_dnt_session\b/)
    expect(md).not.toMatch(/\bupdate_dnt\b/)
    expect(md).not.toMatch(/\bmodify_dnt_answer\b/)
    expect(md).not.toMatch(/\bget_dnt_session_details\b/)
    expect(md).toMatch(/expiring|renewal/i) // renewal-without-application exposure
  })
  it('(1) identity hard-gates acceptance, not application', () => {
    expect(md).toMatch(/accept_quote[^\n]*verified/i)
    expect(md).not.toMatch(/candidate set \*\*and\*\* customer identified/)
  })
  it('(6)(7) policy lifecycle states + refund effect present', () => {
    expect(md).toMatch(/pending_submission/)
    expect(md).toMatch(/\bsubmitted\b/)
    expect(md).toMatch(/refund/i)
  })
  it('(8) dropped list reads are gone; profile read renamed; the ONE list read present', () => {
    expect(md).not.toMatch(/get_application_list/)
    expect(md).not.toMatch(/get_quote_list/)
    expect(md).toMatch(/get_customer_profile/)
    expect(md).toMatch(/get_open_items/)
  })
  it('(9) per-phase tables demoted to documentation grouping', () => {
    expect(md).toMatch(/documentation grouping|grouping only|not the exposure rule/i)
  })
  it('(10) assumptions: visibility-only DNT branching + sign_dnt appends ConsentEvent', () => {
    expect(md).toMatch(/visibility-only/i)
    expect(md).toMatch(/ConsentEvent/)
  })
  it('(11) no caller-supplied identity inputs survive', () => {
    expect(md).not.toMatch(/\| *user_id *\|/)
    expect(md).not.toMatch(/session\/identity/)
  })
  it('(12, erratum/T8.D4) single payment-recovery commit with mode in the response', () => {
    expect(md).toMatch(/ensure_payment_session/)
    expect(md).toMatch(/started[\s\S]*resumed[\s\S]*retried/)
    expect(md).not.toMatch(/\bresume_payment\b/)
    expect(md).not.toMatch(/\bretry_payment\b/)
  })
  it('(ADD-1 #12) resume_application is typed as a read', () => {
    expect(md).toMatch(/`resume_application` *\| *R/)
  })
  it('exactly two spec sources exist: the .feature and the catalog .md (duplicates deleted)', () => {
    const dir = path.join(process.cwd(), 'docs/tools as wokflow scenarios')
    expect(fs.readdirSync(dir).sort()).toEqual(['zeno_tool_catalog.md', 'zeno_workflow.feature'])
  })
})
