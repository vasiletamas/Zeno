/**
 * Partial unique indexes Prisma cannot express in schema.prisma. Idempotent
 * (IF NOT EXISTS) so the full seed AND the integration ring's resetDb can both
 * call it — the ring can no longer be silently missing (or contaminated by) a
 * partial index from a differently-provisioned test DB (P0-3 lesson).
 *
 * Kept in its OWN module (not prisma/seeds/index.ts) because that file invokes
 * main() at import time — importing the helper from there would run the whole
 * seed as a side effect.
 */
export async function ensurePartialUniqueIndexes(db: {
  $executeRawUnsafe: (q: string) => Promise<unknown>
}): Promise<void> {
  // B2: at most one ACTIVE DntSession per customer.
  await db.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "DntSession_one_active_per_customer" ON "DntSession"("customerId") WHERE "status" = 'ACTIVE'`,
  )
  // B4.1: at most one live application per (customer, product).
  await db.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Application_one_open_per_product" ON "Application"("customerId", "productId") WHERE "status" IN ('OPEN','PAUSED','REFERRED')`,
  )
  // C1.4: at most one ACTIVE answer revision per (question, application).
  await db.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "answer_active_unique" ON "Answer"("questionId", "applicationId") WHERE "status" = 'ACTIVE'`,
  )
  // E1.1: product-level ProductContent rows carry addonId NULL — this partial
  // index closes the duplicate-row hole the composite unique leaves open.
  await db.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "ProductContent_product_level_unique" ON "ProductContent"("productId", "field", "locale", "version") WHERE "addonId" IS NULL`,
  )
  // P0-3: at most one OPEN (PENDING) payment attempt per installment — the DB
  // backstop that makes the double-capturable-session race unwinnable even if
  // two money commits slip past the customer-scoped gateway lock.
  await db.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Payment_one_open_per_installment" ON "Payment"("installmentId") WHERE "status" = 'PENDING'`,
  )
}
