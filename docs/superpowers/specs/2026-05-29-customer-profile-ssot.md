# Customer Profile SSOT

**Date:** 2026-05-29 (reconstructed 2026-07-02 — the original document predates this repo's spec
directory and is re-landed here per M1 item 4 so the amendment below has a single home; one spec,
no duplicate)

## Problem

Customer profile facts historically lived in two diverging stores:

1. **Customer columns** (`name`, `email`, `phone`, `dateOfBirth`, `cnp*`) — written by
   `collect_customer_field` with per-field validation.
2. **`Customer.extractedProfile` JSON** — shallow-merged by `update_customer_profile` with
   whatever the agent passed (age, occupation, familySize, interests, …), no validation, no
   record of where a value came from or whether it was ever confirmed.

The two stores disagreed in practice (a declared age in JSON vs a computed age from DOB; a
"verified" name overwritten by a later chat guess), and nothing recorded which value to trust.

## Decision

ONE service is the sole read/write path for profile facts. Consumers never touch profile
storage directly; they call the service. The JSON divergence store is retired.

---

## Amended 2026-06-12 — per-field provenance

Adopted by the Zeno v3 transformation plan (Package B0). This amendment supersedes the storage
model above; the single-service rule is unchanged.

### Storage

`CustomerProfileField` — one row per `(customerId, field)`:

| column | meaning |
| --- | --- |
| `value` | the fact (cnp stored as the AES-GCM JSON envelope, never plaintext; masked on read) |
| `provenance` | `declared` \| `verified` \| `conflict` |
| `source` | who wrote it (`collect_customer_field`, `document_extraction`, operator, …) |
| `evidenceRef` | pointer to the verifying evidence (document id, challenge id) — verified writes only |
| `conflictValue` / `conflictSource` | the losing value kept for review when a conflict is flagged |
| `recordedAt` | when the fact was asserted |

A few fields (`email`, `phone`, `name`, `dateOfBirth`, `cnp*`) are write-through **mirrored**
onto legacy Customer columns so existing consumers keep working; mirrors are never a read
source of truth. A mirror unique-collision (declaring an email already held by another
customer) keeps the provenance row, skips the mirror, and surfaces `mirrorConflict` — the
returning-customer claim path resolves it (see claim-and-merge).

### Write rules (pure decision core: `lib/engines/provenance-rules.ts`)

- Fresh declared write applies; a newer declared value overwrites an older declared value.
- **Declared can never displace verified** (T4-R3): a declared write over a differing verified
  value is rejected with `field_verified_immutable`; over a matching verified value it is a noop.
- A verified write over a differing declared value applies with `provenance: conflict`,
  keeping the declared value in `conflictValue` for review; over a matching declared value it
  flips the row to `verified`. Value matching is diacritics-insensitive and
  whitespace-normalized.

### Derived age

Age is never stored. `getAge` derives it with precedence **dateOfBirth → declaredAge**
(computed age from DOB wins over any declared age figure).

### Claim-and-merge (`lib/customer/claim-merge.ts`)

Folding a duplicate customer shell into the canonical one:

- Aggregates re-point through an extensible repointer registry (Conversation, Application,
  Quote, Policy, Payment, CustomerInsight; later packages append their tables).
- Fields merge by the provenance rule: **verified beats declared; newer declared beats older
  declared; differing verified values flag a conflict** (both kept). cnp envelopes are decoded
  before matching so equal cnps never flag ciphertext conflicts.
- The duplicate is **tombstoned** (`mergedIntoId`, `mergedAt`), its unique/PII mirrors cleared
  first so the canonical customer can hold them.

### Consequences

- `update_customer_profile` is retired (registry, validation, exposure rules).
- `Customer.extractedProfile` is dropped.
- Identity tier is derived, never stored: collecting declared fields does not flip
  `isAnonymous` (T4-R2).
- GDPR erasure deletes `CustomerProfileField` rows alongside the Customer PII mirrors.
