/**
 * Disclosure gate predicate (D2.3, T7.D2) — pure, no DB.
 *
 * A disclosure is satisfied only by an acknowledgement bound to the EXACT
 * document identity (kind, version, language): an old-version or
 * other-language ack never satisfies the current document. Registered as an
 * exposure-predicate input consumed by deriveAndExpose / the gateway
 * legality step (D2 erratum 1) — the accept_quote requires_disclosures gate
 * and get_quote_info both speak through this one set-difference.
 */
export interface DisclosureRef { kind: 'IPID' | 'TERMS'; version: number; language: string }

export function disclosuresRequired<T extends DisclosureRef>(current: T[], acks: DisclosureRef[]): T[] {
  return current.filter((doc) => !acks.some((a) => a.kind === doc.kind && a.version === doc.version && a.language === doc.language))
}
