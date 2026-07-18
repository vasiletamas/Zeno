/**
 * FX reference providers (T18, P4.2 — ruling: BNR daily reference, frozen
 * into the rating snapshot).
 *
 * The engine's currency guard (quote-engine.ts) refuses to sum mixed
 * denominations without an FxReference; THIS module is where that reference
 * comes from. Two providers behind one interface:
 *
 *  - FixedFxProvider (DEFAULT): env `FX_EUR_RON` (default '5.06'), source
 *    'fixed:env'. Tests and dev never touch the network.
 *  - BnrFxProvider: the National Bank of Romania daily reference XML
 *    (https://www.bnr.ro/nbrfxrates.xml), source 'bnr:daily'. The parser is
 *    a separate pure function so it unit-tests against an inline fixture.
 *
 * Selection: env `FX_PROVIDER` ('bnr' | 'fixed'), default 'fixed'.
 * The reference the quote was priced with freezes VERBATIM into
 * Quote.ratingInputs.fx — re-pricing never re-fetches.
 */
import type { FxReference } from '@/lib/engines/quote-engine'

export type { FxReference }

export interface FxProvider {
  /** rate is quote-per-base: RON per EUR (amountRON = amountEUR * rate) */
  getReference(base: 'EUR', quote: 'RON'): Promise<FxReference>
}

export class FixedFxProvider implements FxProvider {
  async getReference(_base: 'EUR' = 'EUR', _quote: 'RON' = 'RON'): Promise<FxReference> {
    const raw = (process.env.FX_EUR_RON ?? '').trim() || '5.06'
    const rate = Number(raw)
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`invalid_fx_rate: FX_EUR_RON="${raw}" is not a positive number`)
    }
    return { rate, date: new Date().toISOString().slice(0, 10), source: 'fixed:env' }
  }
}

export const BNR_FX_URL = 'https://www.bnr.ro/nbrfxrates.xml'

/**
 * Parse the BNR daily-rates XML: `<Cube date="YYYY-MM-DD">` +
 * `<Rate currency="EUR">4.9776</Rate>`. Pure — the ONLY thing the network
 * test never needs. Malformed input throws legibly instead of yielding NaN.
 */
export function parseBnrFxRates(xml: string): { rate: number; date: string } {
  const dateMatch = /<Cube[^>]*\bdate="(\d{4}-\d{2}-\d{2})"/.exec(xml)
  if (!dateMatch) {
    throw new Error('bnr_fx_parse_failed: no <Cube date="YYYY-MM-DD"> found in the BNR XML')
  }
  const rateMatch = /<Rate\s+currency="EUR"[^>]*>([\d.]+)<\/Rate>/.exec(xml)
  if (!rateMatch) {
    throw new Error('bnr_fx_parse_failed: no <Rate currency="EUR"> found in the BNR XML')
  }
  const rate = Number(rateMatch[1])
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`bnr_fx_parse_failed: EUR rate "${rateMatch[1]}" is not a positive number`)
  }
  return { rate, date: dateMatch[1] }
}

export class BnrFxProvider implements FxProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async getReference(_base: 'EUR' = 'EUR', _quote: 'RON' = 'RON'): Promise<FxReference> {
    const res = await this.fetchImpl(BNR_FX_URL)
    if (!res.ok) {
      throw new Error(`bnr_fx_fetch_failed: HTTP ${res.status} from ${BNR_FX_URL}`)
    }
    const { rate, date } = parseBnrFxRates(await res.text())
    return { rate, date, source: 'bnr:daily' }
  }
}

/** env `FX_PROVIDER` ('bnr' | 'fixed'); default 'fixed' — never the network unless asked. */
export function getFxProvider(): FxProvider {
  return (process.env.FX_PROVIDER ?? 'fixed').trim() === 'bnr' ? new BnrFxProvider() : new FixedFxProvider()
}
