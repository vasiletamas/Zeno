/**
 * T18 (P4.2): the pluggable FX reference — a fixed env-configured rate
 * (default, so tests and dev never touch the network) and the BNR daily
 * XML (parser unit-tested against an inline fixture, never the wire).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { FixedFxProvider, BnrFxProvider, parseBnrFxRates, getFxProvider } from '@/lib/engines/fx'

const BNR_XML = `<?xml version="1.0" encoding="utf-8"?>
<DataSet xmlns="http://www.bnr.ro/xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Header>
    <Publisher>National Bank of Romania</Publisher>
    <PublishingDate>2026-07-17</PublishingDate>
    <MessageType>DR</MessageType>
  </Header>
  <Body>
    <Subject>Reference rates</Subject>
    <OrigCurrency>RON</OrigCurrency>
    <Cube date="2026-07-17">
      <Rate currency="AED">1.2345</Rate>
      <Rate currency="EUR">4.9776</Rate>
      <Rate currency="HUF" multiplier="100">1.2653</Rate>
      <Rate currency="USD">4.2801</Rate>
    </Cube>
  </Body>
</DataSet>`

afterEach(() => vi.unstubAllEnvs())

describe('FixedFxProvider', () => {
  it('defaults to 5.06 EUR→RON with source fixed:env and a dated reference', async () => {
    const ref = await new FixedFxProvider().getReference('EUR', 'RON')
    expect(ref.rate).toBe(5.06)
    expect(ref.source).toBe('fixed:env')
    expect(ref.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('honours the FX_EUR_RON env override', async () => {
    vi.stubEnv('FX_EUR_RON', '4.98')
    const ref = await new FixedFxProvider().getReference('EUR', 'RON')
    expect(ref.rate).toBe(4.98)
  })

  it('rejects a garbage FX_EUR_RON with a legible error instead of pricing on NaN', async () => {
    vi.stubEnv('FX_EUR_RON', 'not-a-rate')
    await expect(new FixedFxProvider().getReference('EUR', 'RON')).rejects.toThrow(/invalid_fx_rate/)
  })
})

describe('parseBnrFxRates (the BNR daily XML)', () => {
  it('extracts the EUR rate and the Cube date', () => {
    expect(parseBnrFxRates(BNR_XML)).toEqual({ rate: 4.9776, date: '2026-07-17' })
  })

  it('malformed XML (no EUR rate) throws a legible bnr_fx_parse_failed', () => {
    expect(() => parseBnrFxRates('<DataSet><Body><Cube date="2026-07-17"></Cube></Body></DataSet>')).toThrow(/bnr_fx_parse_failed/)
  })

  it('missing Cube date throws a legible bnr_fx_parse_failed', () => {
    expect(() => parseBnrFxRates('<Cube><Rate currency="EUR">4.9776</Rate></Cube>')).toThrow(/bnr_fx_parse_failed/)
  })
})

describe('BnrFxProvider', () => {
  it('returns the parsed reference with source bnr:daily (fetch injected — no network)', async () => {
    const fakeFetch = vi.fn(async () => new Response(BNR_XML, { status: 200 }))
    const ref = await new BnrFxProvider(fakeFetch as unknown as typeof fetch).getReference('EUR', 'RON')
    expect(ref).toEqual({ rate: 4.9776, date: '2026-07-17', source: 'bnr:daily' })
    expect(fakeFetch).toHaveBeenCalledWith('https://www.bnr.ro/nbrfxrates.xml')
  })

  it('a non-200 answer throws a legible bnr_fx_fetch_failed', async () => {
    const fakeFetch = vi.fn(async () => new Response('teapot', { status: 418 }))
    await expect(new BnrFxProvider(fakeFetch as unknown as typeof fetch).getReference('EUR', 'RON')).rejects.toThrow(/bnr_fx_fetch_failed/)
  })
})

describe('getFxProvider', () => {
  it('defaults to the fixed provider (tests/dev never hit the network)', () => {
    expect(getFxProvider()).toBeInstanceOf(FixedFxProvider)
  })

  it('FX_PROVIDER=bnr selects the BNR provider', () => {
    vi.stubEnv('FX_PROVIDER', 'bnr')
    expect(getFxProvider()).toBeInstanceOf(BnrFxProvider)
  })
})
