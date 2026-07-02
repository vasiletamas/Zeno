/**
 * Seed: Default Admin User
 *
 * Creates the default admin user from environment variables.
 * Uses bcryptjs for password hashing (12 rounds).
 */

import { PrismaClient } from '../../lib/generated/prisma/client'
import bcrypt from 'bcryptjs'

export async function seedUsers(prisma: PrismaClient) {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@zeno.ro'
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'

  const passwordHash = await bcrypt.hash(adminPassword, 12)

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
    create: {
      email: adminEmail,
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
  })

  console.log(`  Admin user seeded: ${adminEmail}`)

  // E2 erratum 4: an OPERATOR account so the work-item queue is reachable
  // from a real login, not only from tokens minted in tests.
  const operatorEmail = process.env.OPERATOR_EMAIL || 'operator@zeno.ro'
  const operatorPassword = process.env.OPERATOR_PASSWORD || 'operator123'
  const operatorHash = await bcrypt.hash(operatorPassword, 12)

  await prisma.user.upsert({
    where: { email: operatorEmail },
    update: {
      passwordHash: operatorHash,
      role: 'OPERATOR',
      isActive: true,
    },
    create: {
      email: operatorEmail,
      passwordHash: operatorHash,
      role: 'OPERATOR',
      isActive: true,
    },
  })

  console.log(`  Operator user seeded: ${operatorEmail}`)
}
